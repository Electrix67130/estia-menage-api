import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  MenageEquipementLine,
  MenageEquipementRow,
  SetMenageEquipements,
} from './menage-equipement.schema';

class MenageEquipementService extends BaseService<MenageEquipementRow> {
  constructor(db: Knex) {
    super(db, 'menage_equipement');
  }

  /** Équipements demandés pour une prestation, avec le libellé et la pièce. */
  async findByMenage(menageId: string): Promise<MenageEquipementLine[]> {
    return this.db('menage_equipement as me')
      .join('logement_equipement as e', 'me.logement_equipement_id', 'e.id')
      .leftJoin('logement_room as r', 'e.logement_room_id', 'r.id')
      .leftJoin('user as u', 'me.done_by', 'u.id')
      .where('me.menage_id', menageId)
      .orderBy('e.position', 'asc')
      .orderBy('e.label', 'asc')
      .select(
        'me.*',
        'e.label',
        'e.category',
        'r.name as room_name',
        'u.first_name as done_by_first_name',
        'u.last_name as done_by_last_name',
      ) as Promise<MenageEquipementLine[]>;
  }

  /**
   * Remplace la liste des équipements à préparer d'une prestation (admin).
   * Les lignes conservées gardent leur `done_at` : re-enregistrer la liste ne
   * décoche pas ce que le prestataire a déjà préparé.
   */
  async setForMenage(menageId: string, data: SetMenageEquipements): Promise<MenageEquipementLine[]> {
    const wanted = new Map(data.items.map((i) => [i.logement_equipement_id, i]));

    await this.db.transaction(async (trx) => {
      const existing = (await trx('menage_equipement')
        .where({ menage_id: menageId })
        .select('id', 'logement_equipement_id')) as Array<{
        id: string;
        logement_equipement_id: string;
      }>;
      const existingIds = new Set(existing.map((e) => e.logement_equipement_id));

      const toDelete = existing
        .filter((e) => !wanted.has(e.logement_equipement_id))
        .map((e) => e.id);
      if (toDelete.length > 0) await trx('menage_equipement').whereIn('id', toDelete).del();

      const toInsert = data.items
        .filter((i) => !existingIds.has(i.logement_equipement_id))
        .map((i) => ({
          menage_id: menageId,
          logement_equipement_id: i.logement_equipement_id,
          quantity: i.quantity ?? 1,
          notes: i.notes ?? null,
        }));
      if (toInsert.length > 0) await trx('menage_equipement').insert(toInsert);

      // Mise à jour des lignes conservées (quantité / notes) sans toucher `done_at`.
      for (const e of existing) {
        const item = wanted.get(e.logement_equipement_id);
        if (!item) continue;
        await trx('menage_equipement')
          .where({ id: e.id })
          .update({
            quantity: item.quantity ?? 1,
            notes: item.notes ?? null,
            updated_at: new Date(),
          });
      }
    });

    return this.findByMenage(menageId);
  }

  /** Coche / décoche un équipement préparé (prestataire affecté ou admin). */
  async setDone(
    menageId: string,
    equipementId: string,
    done: boolean,
    userId: string,
  ): Promise<MenageEquipementLine | undefined> {
    await this.db('menage_equipement')
      .where({ menage_id: menageId, logement_equipement_id: equipementId })
      .update({
        done_at: done ? new Date() : null,
        done_by: done ? userId : null,
        updated_at: new Date(),
      });
    const lines = await this.findByMenage(menageId);
    return lines.find((l) => l.logement_equipement_id === equipementId);
  }
}

export default MenageEquipementService;
