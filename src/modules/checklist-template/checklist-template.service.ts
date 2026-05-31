import { Knex } from 'knex';
import {
  ChecklistTemplateRow,
  ChecklistTemplateSectionRow,
  ChecklistTemplateItemRow,
  ChecklistTemplateTree,
  TemplateSectionInput,
} from './checklist-template.schema';

class ChecklistTemplateService {
  constructor(private db: Knex) {}

  async listByOrg(organizationId: string): Promise<(ChecklistTemplateRow & { section_count: number })[]> {
    const rows = (await this.db('checklist_template')
      .leftJoin(
        'checklist_template_section',
        'checklist_template_section.template_id',
        'checklist_template.id',
      )
      .where('checklist_template.organization_id', organizationId)
      .groupBy('checklist_template.id')
      .select(
        'checklist_template.*',
        this.db.raw('COUNT(checklist_template_section.id)::int as section_count'),
      )
      .orderBy('checklist_template.name', 'asc')) as (ChecklistTemplateRow & {
      section_count: number;
    })[];
    return rows;
  }

  async findTree(id: string, organizationId: string): Promise<ChecklistTemplateTree | null> {
    const template = (await this.db('checklist_template')
      .where({ id, organization_id: organizationId })
      .first()) as ChecklistTemplateRow | undefined;
    if (!template) return null;

    const sections = (await this.db('checklist_template_section')
      .where({ template_id: id })
      .orderBy('position', 'asc')) as ChecklistTemplateSectionRow[];
    const sectionIds = sections.map((s) => s.id);
    const items = sectionIds.length
      ? ((await this.db('checklist_template_item')
          .whereIn('section_id', sectionIds)
          .orderBy('position', 'asc')) as ChecklistTemplateItemRow[])
      : [];

    const bySection = new Map<string, ChecklistTemplateItemRow[]>();
    for (const it of items) {
      const arr = bySection.get(it.section_id) ?? [];
      arr.push(it);
      bySection.set(it.section_id, arr);
    }
    return {
      ...template,
      sections: sections.map((s) => ({ ...s, items: bySection.get(s.id) ?? [] })),
    };
  }

  /** Crée le modèle + son arbre (sections/items) en une transaction. */
  async createWithTree(
    organizationId: string,
    name: string,
    sections: TemplateSectionInput[],
  ): Promise<string> {
    return this.db.transaction(async (trx) => {
      const [tpl] = (await trx('checklist_template')
        .insert({ organization_id: organizationId, name })
        .returning('id')) as { id: string }[];
      await this.insertTree(trx, tpl.id, sections);
      return tpl.id;
    });
  }

  /** Met à jour le nom et/ou remplace intégralement l'arbre. */
  async updateWithTree(
    id: string,
    patch: { name?: string; sections?: TemplateSectionInput[] },
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      if (patch.name !== undefined) {
        await trx('checklist_template').where({ id }).update({ name: patch.name, updated_at: new Date() });
      }
      if (patch.sections !== undefined) {
        // Remplacement complet : on purge puis on réinsère (CASCADE supprime les items).
        await trx('checklist_template_section').where({ template_id: id }).del();
        await this.insertTree(trx, id, patch.sections);
      }
    });
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const n = await this.db('checklist_template').where({ id, organization_id: organizationId }).del();
    return n > 0;
  }

  /**
   * Applique un modèle à un logement : copie ses sections+items dans les tables
   * `logement_check_template_*`. N'écrase pas l'existant — ajoute à la suite.
   */
  async applyToLogement(templateId: string, organizationId: string, logementId: string): Promise<boolean> {
    const tree = await this.findTree(templateId, organizationId);
    if (!tree) return false;
    await this.db.transaction(async (trx) => {
      const existingCount = (await trx('logement_check_template_section')
        .where({ logement_id: logementId })
        .count('* as c')
        .first()) as { c: string } | undefined;
      let pos = existingCount ? parseInt(existingCount.c, 10) : 0;
      for (const section of tree.sections) {
        const [sec] = (await trx('logement_check_template_section')
          .insert({ logement_id: logementId, label: section.label, position: pos })
          .returning('id')) as { id: string }[];
        pos += 1;
        if (section.items.length) {
          await trx('logement_check_template_item').insert(
            section.items.map((it, idx) => ({
              section_id: sec.id,
              label: it.label,
              position: idx,
              required: it.required,
            })),
          );
        }
      }
    });
    return true;
  }

  private async insertTree(
    trx: Knex.Transaction,
    templateId: string,
    sections: TemplateSectionInput[],
  ): Promise<void> {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const [sec] = (await trx('checklist_template_section')
        .insert({ template_id: templateId, label: section.label, position: i })
        .returning('id')) as { id: string }[];
      if (section.items.length) {
        await trx('checklist_template_item').insert(
          section.items.map((it, idx) => ({
            section_id: sec.id,
            label: it.label,
            position: idx,
            required: it.required ?? true,
          })),
        );
      }
    }
  }
}

export default ChecklistTemplateService;
