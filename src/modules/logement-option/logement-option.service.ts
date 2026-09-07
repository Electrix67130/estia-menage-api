import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  CreateLogementOption,
  LogementOptionRow,
  MenageOptionLine,
  SetMenageOptions,
} from './logement-option.schema';

class LogementOptionService extends BaseService<LogementOptionRow> {
  constructor(db: Knex) {
    super(db, 'logement_option');
  }

  /** Options configurées sur un logement. */
  async findByLogement(logementId: string): Promise<LogementOptionRow[]> {
    return this.db('logement_option')
      .where({ logement_id: logementId })
      .orderBy('position', 'asc')
      .orderBy('label', 'asc');
  }

  private async nextPosition(logementId: string): Promise<number> {
    const row = (await this.db('logement_option')
      .where({ logement_id: logementId })
      .max('position as max')
      .first()) as { max: number | null } | undefined;
    return (row?.max ?? -1) + 1;
  }

  async createForLogement(data: CreateLogementOption): Promise<LogementOptionRow> {
    const [row] = (await this.db('logement_option')
      .insert({
        ...data,
        label: data.label.trim(),
        position: data.position ?? (await this.nextPosition(data.logement_id)),
      })
      .returning('*')) as LogementOptionRow[];
    return row;
  }

  /** Options retenues pour une prestation, avec le libellé et la description. */
  async findByMenage(menageId: string): Promise<MenageOptionLine[]> {
    return this.db('menage_option as mo')
      .join('logement_option as o', 'mo.logement_option_id', 'o.id')
      .where('mo.menage_id', menageId)
      .orderBy('o.position', 'asc')
      .orderBy('o.label', 'asc')
      .select('mo.*', 'o.label', 'o.description') as Promise<MenageOptionLine[]>;
  }

  /** Remplace les options retenues d'une prestation (admin). */
  async setForMenage(menageId: string, data: SetMenageOptions): Promise<MenageOptionLine[]> {
    const wanted = new Map(data.items.map((i) => [i.logement_option_id, i]));

    await this.db.transaction(async (trx) => {
      const existing = (await trx('menage_option')
        .where({ menage_id: menageId })
        .select('id', 'logement_option_id')) as Array<{ id: string; logement_option_id: string }>;
      const existingIds = new Set(existing.map((e) => e.logement_option_id));

      const toDelete = existing.filter((e) => !wanted.has(e.logement_option_id)).map((e) => e.id);
      if (toDelete.length > 0) await trx('menage_option').whereIn('id', toDelete).del();

      const toInsert = data.items
        .filter((i) => !existingIds.has(i.logement_option_id))
        .map((i) => ({
          menage_id: menageId,
          logement_option_id: i.logement_option_id,
          notes: i.notes ?? null,
        }));
      if (toInsert.length > 0) await trx('menage_option').insert(toInsert);

      for (const e of existing) {
        const item = wanted.get(e.logement_option_id);
        if (!item) continue;
        await trx('menage_option')
          .where({ id: e.id })
          .update({ notes: item.notes ?? null, updated_at: new Date() });
      }
    });

    return this.findByMenage(menageId);
  }
}

export default LogementOptionService;
