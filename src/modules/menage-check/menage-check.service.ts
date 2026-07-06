import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  MenageCheckSectionRow,
  MenageCheckItemRow,
  MenageCheckTree,
} from './menage-check.schema';
import { buildSectionPlan, DEFAULT_CHECK_ITEMS_BY_TYPE } from './check-templates';
import { LogementRow } from '@/modules/logement/logement.schema';

export class MenageCheckSectionService extends BaseService<MenageCheckSectionRow> {
  constructor(db: Knex) {
    super(db, 'menage_check_section');
  }

  async reorder(menageId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('menage_check_section')
          .where({ id: orderedIds[i], menage_id: menageId })
          .update({ position: i, updated_at: new Date() });
      }
    });
  }
}

export class MenageCheckItemService extends BaseService<MenageCheckItemRow> {
  constructor(db: Knex) {
    super(db, 'menage_check_item');
  }

  async reorder(sectionId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('menage_check_item')
          .where({ id: orderedIds[i], section_id: sectionId })
          .update({ position: i, updated_at: new Date() });
      }
    });
  }

  async toggle(
    id: string,
    validated: boolean,
    userId: string,
    comment?: string,
  ): Promise<MenageCheckItemRow | undefined> {
    const now = new Date();
    const update: Record<string, unknown> = {
      validated_at: validated ? now : null,
      validated_by: validated ? userId : null,
      updated_at: now,
    };
    if (comment !== undefined) update.comment = comment;
    const [row] = (await this.db('menage_check_item')
      .where({ id })
      .update(update)
      .returning('*')) as MenageCheckItemRow[];
    return row;
  }

  /** Coche/décoche tous les items d'une section d'un coup. Retourne le nb d'items affectés. */
  async toggleBySection(sectionId: string, validated: boolean, userId: string): Promise<number> {
    const now = new Date();
    return this.db('menage_check_item')
      .where({ section_id: sectionId })
      .update({
        validated_at: validated ? now : null,
        validated_by: validated ? userId : null,
        updated_at: now,
      });
  }

  /** Coche/décoche tous les items de toutes les sections d'un ménage. */
  async toggleByMenage(menageId: string, validated: boolean, userId: string): Promise<number> {
    const now = new Date();
    const sectionIds = (await this.db('menage_check_section')
      .where({ menage_id: menageId })
      .pluck('id')) as string[];
    if (sectionIds.length === 0) return 0;
    return this.db('menage_check_item')
      .whereIn('section_id', sectionIds)
      .update({
        validated_at: validated ? now : null,
        validated_by: validated ? userId : null,
        updated_at: now,
      });
  }
}

/**
 * Génère la checklist initiale d'un ménage.
 *
 * Si le logement a un template personnalisé (au moins une section dans
 * `logement_check_template_section`), on l'utilise. Sinon on retombe sur le
 * plan par défaut dérivé des attributs du logement (nb de chambres, etc).
 *
 * À appeler dans la même transaction que la création du ménage.
 */
export async function generateChecklistForMenage(
  trx: Knex.Transaction,
  menageId: string,
  logement: LogementRow,
): Promise<void> {
  const templateSections = (await trx('logement_check_template_section')
    .where({ logement_id: logement.id })
    .orderBy('position', 'asc')) as Array<{ id: string; label: string; icon: string | null }>;

  if (templateSections.length > 0) {
    // Path 1 : template personnalisé du logement
    for (let i = 0; i < templateSections.length; i++) {
      const tpl = templateSections[i];
      const [created] = (await trx('menage_check_section')
        .insert({
          menage_id: menageId,
          section_type: 'general',
          section_label: tpl.label,
          icon: tpl.icon ?? null,
          position: i,
        })
        .returning('*')) as MenageCheckSectionRow[];

      const templateItems = (await trx('logement_check_template_item')
        .where({ section_id: tpl.id })
        .orderBy('position', 'asc')) as Array<{ label: string }>;

      if (templateItems.length > 0) {
        await trx('menage_check_item').insert(
          templateItems.map((it, idx) => ({
            section_id: created.id,
            item_label: it.label,
            position: idx,
          })),
        );
      }
    }
    return;
  }

  // Path 2 : plan auto-généré depuis les attributs du logement
  const sections = buildSectionPlan(logement);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const [created] = (await trx('menage_check_section')
      .insert({
        menage_id: menageId,
        section_type: section.type,
        section_label: section.label,
        position: i,
      })
      .returning('*')) as MenageCheckSectionRow[];

    const items = DEFAULT_CHECK_ITEMS_BY_TYPE[section.type];
    if (items.length > 0) {
      await trx('menage_check_item').insert(
        items.map((label, idx) => ({
          section_id: created.id,
          item_label: label,
          position: idx,
        })),
      );
    }
  }
}

/**
 * Charge l'arbre complet (sections + items imbriqués) d'un ménage.
 */
export async function findChecklistTree(
  db: Knex,
  menageId: string,
): Promise<MenageCheckTree> {
  const sections = (await db('menage_check_section')
    .where({ menage_id: menageId })
    .orderBy('position', 'asc')) as MenageCheckSectionRow[];

  if (sections.length === 0) return [];

  const sectionIds = sections.map((s) => s.id);
  const items = (await db('menage_check_item')
    .whereIn('section_id', sectionIds)
    .orderBy('position', 'asc')) as MenageCheckItemRow[];

  const itemsBySection = new Map<string, MenageCheckItemRow[]>();
  for (const item of items) {
    const arr = itemsBySection.get(item.section_id) ?? [];
    arr.push(item);
    itemsBySection.set(item.section_id, arr);
  }

  return sections.map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) ?? [],
  }));
}
