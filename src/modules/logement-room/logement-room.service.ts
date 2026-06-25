import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { CreateLogementRoom, LogementRoomRow, RoomKind } from './logement-room.schema';

/** Libellé singulier par type de pièce, utilisé pour auto-générer le nom (« Salle de bain 1 »). */
const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  chambre: 'Chambre',
  salle_de_bain: 'Salle de bain',
  wc: 'WC',
  cuisine: 'Cuisine',
  salon: 'Salon',
  salle_a_manger: 'Salle à manger',
  bureau: 'Bureau',
  entree: 'Entrée',
  couloir: 'Couloir',
  exterieur: 'Extérieur',
  cave: 'Cave',
  buanderie: 'Buanderie',
  piscine: 'Piscine',
  jacuzzi: 'Jacuzzi',
  autre: 'Autre',
};

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
  has_pool: boolean;
  has_jacuzzi: boolean;
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
  field: keyof Pick<RoomCountSnapshot, 'has_basement' | 'has_laundry' | 'has_pool' | 'has_jacuzzi'>;
  def: RoomDefaultDef;
}> = [
  { field: 'has_basement', def: { kind: 'cave', singular: 'Cave' } },
  { field: 'has_laundry', def: { kind: 'buanderie', singular: 'Buanderie' } },
  { field: 'has_pool', def: { kind: 'piscine', singular: 'Piscine' } },
  { field: 'has_jacuzzi', def: { kind: 'jacuzzi', singular: 'Jacuzzi' } },
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
   * Nom auto-généré pour une pièce typée : « {Label} {N} » où N est le prochain
   * indice libre parmi les pièces du même type du logement (anti-collision, même
   * après suppression). Le type « autre » n'est pas auto-nommé (nom libre requis).
   */
  async deriveRoomName(logementId: string, kind: RoomKind, excludeId?: string): Promise<string> {
    const label = ROOM_KIND_LABELS[kind];
    const existing = (await this.db('logement_room')
      .where({ logement_id: logementId, kind })
      .modify((q) => {
        if (excludeId) q.andWhereNot('id', excludeId);
      })) as LogementRoomRow[];
    const taken = new Set(existing.map((r) => r.name));
    let n = existing.length + 1;
    while (taken.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  /**
   * Crée une pièce en dérivant son nom depuis le type (sauf « autre »).
   */
  async createForLogement(data: CreateLogementRoom): Promise<LogementRoomRow> {
    // Type fourni (hors « autre ») → nom auto-généré. Sinon (ancien client sans
    // type, ou type « autre ») → nom libre fourni (garanti par le schéma).
    const name =
      data.kind !== undefined && data.kind !== 'autre'
        ? await this.deriveRoomName(data.logement_id, data.kind)
        : (data.name as string).trim();
    const [row] = (await this.db('logement_room')
      .insert({ ...data, name })
      .returning('*')) as LogementRoomRow[];
    return row;
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
