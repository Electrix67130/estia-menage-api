import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  BulkCreateLogementEquipement,
  CreateLogementEquipement,
  LogementEquipementRow,
} from './logement-equipement.schema';

/** Clé de dédup d'un libellé : insensible à la casse et aux espaces. */
function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

class LogementEquipementService extends BaseService<LogementEquipementRow> {
  constructor(db: Knex) {
    super(db, 'logement_equipement');
  }

  /** Équipements d'un logement, triés, avec le nom de la pièce rattachée. */
  async findByLogement(logementId: string): Promise<LogementEquipementRow[]> {
    return this.db('logement_equipement as e')
      .leftJoin('logement_room as r', 'e.logement_room_id', 'r.id')
      .where('e.logement_id', logementId)
      .orderBy('e.position', 'asc')
      .orderBy('e.label', 'asc')
      .select('e.*', 'r.name as room_name') as Promise<LogementEquipementRow[]>;
  }

  /** Prochaine position libre sur un logement (ajout en fin de liste). */
  private async nextPosition(logementId: string): Promise<number> {
    const row = (await this.db('logement_equipement')
      .where({ logement_id: logementId })
      .max('position as max')
      .first()) as { max: number | null } | undefined;
    return (row?.max ?? -1) + 1;
  }

  async createForLogement(data: CreateLogementEquipement): Promise<LogementEquipementRow> {
    const [row] = (await this.db('logement_equipement')
      .insert({
        ...data,
        label: data.label.trim(),
        position: data.position ?? (await this.nextPosition(data.logement_id)),
      })
      .returning('*')) as LogementEquipementRow[];
    return row;
  }

  /**
   * Ajout groupé (chips du catalogue). Idempotent : un libellé déjà présent sur
   * le logement est ignoré, pour qu'un double-clic ne crée pas de doublon.
   * Renvoie la liste complète à jour.
   */
  async bulkCreate(data: BulkCreateLogementEquipement): Promise<LogementEquipementRow[]> {
    const existing = await this.findByLogement(data.logement_id);
    const taken = new Set(existing.map((e) => labelKey(e.label)));
    let position = (await this.nextPosition(data.logement_id)) - 1;

    const toInsert = data.items
      .filter((item) => {
        const key = labelKey(item.label);
        if (taken.has(key)) return false;
        taken.add(key); // dédup aussi à l'intérieur du même payload
        return true;
      })
      .map((item) => ({
        logement_id: data.logement_id,
        logement_room_id: item.logement_room_id ?? null,
        label: item.label.trim(),
        category: item.category ?? null,
        quantity: item.quantity ?? 1,
        position: ++position,
      }));

    if (toInsert.length > 0) await this.db('logement_equipement').insert(toInsert);
    return this.findByLogement(data.logement_id);
  }
}

export default LogementEquipementService;
