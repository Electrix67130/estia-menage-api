import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { LogementRoomRow, RoomKind } from './logement-room.schema';

/**
 * Mapping count → kind/singular pour générer automatiquement les pièces
 * d'un logement à partir des compteurs n_*.
 *
 * Quand il y a plusieurs pièces du même kind, on numérote ("Chambre 1", "Chambre 2"...).
 * Quand il n'y en a qu'une, on garde le nom au singulier ("Chambre", "Salon"...).
 */
interface RoomDefaultDef {
  kind: RoomKind;
  singular: string;
}

export interface RoomCountSnapshot {
  n_bedrooms: number;
  n_bathrooms: number;
  n_wc: number;
  n_kitchens: number;
  n_living_rooms: number;
  n_exterior_spaces: number;
  has_basement: boolean;
  has_laundry: boolean;
}

const COUNT_FIELDS: Array<{
  field: keyof Pick<
    RoomCountSnapshot,
    'n_bedrooms' | 'n_bathrooms' | 'n_wc' | 'n_kitchens' | 'n_living_rooms' | 'n_exterior_spaces'
  >;
  def: RoomDefaultDef;
}> = [
  { field: 'n_bedrooms', def: { kind: 'chambre', singular: 'Chambre' } },
  { field: 'n_bathrooms', def: { kind: 'salle_de_bain', singular: 'Salle de bain' } },
  { field: 'n_wc', def: { kind: 'wc', singular: 'WC' } },
  { field: 'n_kitchens', def: { kind: 'cuisine', singular: 'Cuisine' } },
  { field: 'n_living_rooms', def: { kind: 'salon', singular: 'Salon' } },
  { field: 'n_exterior_spaces', def: { kind: 'exterieur', singular: 'Extérieur' } },
];

const FLAG_ROOMS: Array<{
  field: keyof Pick<RoomCountSnapshot, 'has_basement' | 'has_laundry'>;
  def: RoomDefaultDef;
}> = [
  { field: 'has_basement', def: { kind: 'cave', singular: 'Cave' } },
  { field: 'has_laundry', def: { kind: 'buanderie', singular: 'Buanderie' } },
];

class LogementRoomService extends BaseService<LogementRoomRow> {
  constructor(db: Knex) {
    super(db, 'logement_room');
  }

  async findByLogement(logementId: string): Promise<LogementRoomRow[]> {
    return this.db('logement_room')
      .where({ logement_id: logementId })
      .orderBy('position', 'asc')
      .orderBy('name', 'asc');
  }

  /**
   * Génère les pièces d'un logement à partir des compteurs. Idempotent : on
   * crée uniquement les pièces manquantes pour atteindre les counts cibles —
   * les pièces existantes ne sont ni renommées ni supprimées.
   *
   * Convention de nommage :
   * - target=1 ET aucune existante → singulier ("Chambre", "Salon")
   * - sinon → numéroté ("Chambre 1", "Chambre 2", ...)
   *
   * Si les counts ont baissé (ex : on passe de 3 chambres à 2), on ne touche
   * pas aux pièces existantes — l'admin les supprime manuellement s'il le
   * souhaite.
   */
  async generateForLogement(logementId: string, counts: RoomCountSnapshot): Promise<void> {
    const existing = await this.findByLogement(logementId);
    const existingByKind = new Map<string, LogementRoomRow[]>();
    for (const r of existing) {
      if (!r.kind) continue;
      const arr = existingByKind.get(r.kind) ?? [];
      arr.push(r);
      existingByKind.set(r.kind, arr);
    }

    let nextPosition = existing.length;
    const toInsert: Partial<LogementRoomRow>[] = [];

    for (const { field, def } of COUNT_FIELDS) {
      const target = counts[field] ?? 0;
      const already = existingByKind.get(def.kind)?.length ?? 0;
      const missing = Math.max(0, target - already);
      if (missing === 0) continue;
      for (let i = 0; i < missing; i++) {
        const indexInKind = already + i + 1;
        const name =
          target === 1 && already === 0 ? def.singular : `${def.singular} ${indexInKind}`;
        toInsert.push({
          logement_id: logementId,
          name,
          kind: def.kind,
          position: nextPosition++,
        });
      }
    }

    for (const { field, def } of FLAG_ROOMS) {
      if (!counts[field]) continue;
      if ((existingByKind.get(def.kind)?.length ?? 0) > 0) continue;
      toInsert.push({
        logement_id: logementId,
        name: def.singular,
        kind: def.kind,
        position: nextPosition++,
      });
    }

    if (toInsert.length > 0) {
      await this.db('logement_room').insert(toInsert);
    }
  }
}

export default LogementRoomService;
