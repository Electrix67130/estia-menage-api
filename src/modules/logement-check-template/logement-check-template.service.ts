import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  LogementCheckTemplateSectionRow,
  LogementCheckTemplateItemRow,
  LogementCheckTemplateTree,
} from './logement-check-template.schema';

export class LogementCheckTemplateSectionService extends BaseService<LogementCheckTemplateSectionRow> {
  constructor(db: Knex) {
    super(db, 'logement_check_template_section');
  }

  async reorder(logementId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('logement_check_template_section')
          .where({ id: orderedIds[i], logement_id: logementId })
          .update({ position: i, updated_at: new Date() });
      }
    });
  }
}

export class LogementCheckTemplateItemService extends BaseService<LogementCheckTemplateItemRow> {
  constructor(db: Knex) {
    super(db, 'logement_check_template_item');
  }

  async reorder(sectionId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('logement_check_template_item')
          .where({ id: orderedIds[i], section_id: sectionId })
          .update({ position: i, updated_at: new Date() });
      }
    });
  }
}

export async function findTemplateTree(
  db: Knex,
  logementId: string,
): Promise<LogementCheckTemplateTree> {
  const sections = (await db('logement_check_template_section')
    .where({ logement_id: logementId })
    .orderBy('position', 'asc')) as LogementCheckTemplateSectionRow[];

  if (sections.length === 0) return [];

  const sectionIds = sections.map((s) => s.id);
  const items = (await db('logement_check_template_item')
    .whereIn('section_id', sectionIds)
    .orderBy('position', 'asc')) as LogementCheckTemplateItemRow[];

  const itemsBySection = new Map<string, LogementCheckTemplateItemRow[]>();
  for (const item of items) {
    const arr = itemsBySection.get(item.section_id) ?? [];
    arr.push(item);
    itemsBySection.set(item.section_id, arr);
  }

  return sections.map((s) => ({ ...s, items: itemsBySection.get(s.id) ?? [] }));
}

/**
 * Vrai si le logement a au moins une section template définie.
 * Sert à la décision : appliquer le template ou le plan par défaut (selon `check-templates.ts`).
 */
export async function hasCustomTemplate(db: Knex, logementId: string): Promise<boolean> {
  const row = await db('logement_check_template_section')
    .where({ logement_id: logementId })
    .first();
  return Boolean(row);
}
