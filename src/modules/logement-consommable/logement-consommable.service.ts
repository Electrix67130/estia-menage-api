import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  LogementConsommableRow,
  MenageConsommableLine,
} from './logement-consommable.schema';

export type ConsommableStockLine = MenageConsommableLine & {
  recorded_at: string | null;
};

class LogementConsommableService extends BaseService<LogementConsommableRow> {
  constructor(db: Knex) {
    super(db, 'logement_consommable');
  }

  /** Consommables actifs d'un logement (config admin), triés. */
  async findByLogement(logementId: string): Promise<LogementConsommableRow[]> {
    return this.db('logement_consommable')
      .where({ logement_id: logementId })
      .whereNull('archived_at')
      .orderBy('position', 'asc')
      .orderBy('label', 'asc');
  }

  /**
   * Liste des consommables actifs d'un logement AVEC le stock courant = le
   * relevé le plus récent de chaque consommable (tous ménages confondus).
   * `needs_restock` = relevé présent et qty <= seuil.
   */
  async findByLogementWithStock(logementId: string): Promise<ConsommableStockLine[]> {
    const result = (await this.db.raw(
      `SELECT c.id as logement_consommable_id, c.label, c.unit, c.seuil_alerte, c.position,
              latest.qty, latest.recorded_at
       FROM logement_consommable c
       LEFT JOIN LATERAL (
         SELECT r.qty, r.recorded_at
         FROM menage_consommable_releve r
         WHERE r.logement_consommable_id = c.id
         ORDER BY r.recorded_at DESC
         LIMIT 1
       ) latest ON true
       WHERE c.logement_id = ? AND c.archived_at IS NULL
       ORDER BY c.position ASC, c.label ASC`,
      [logementId],
    )) as {
      rows: Array<{
        logement_consommable_id: string;
        label: string;
        unit: string | null;
        seuil_alerte: number;
        position: number;
        qty: number | null;
        recorded_at: string | null;
      }>;
    };
    return result.rows.map((r) => ({
      ...r,
      qty: r.qty === null ? null : Number(r.qty),
      needs_restock: r.qty !== null && Number(r.qty) <= r.seuil_alerte,
    }));
  }

  /** Soft-delete via archived_at (préserve l'historique des relevés). */
  async archive(id: string): Promise<void> {
    await this.db('logement_consommable')
      .where({ id })
      .update({ archived_at: this.db.fn.now(), updated_at: this.db.fn.now() });
  }

  /**
   * Consommables d'un ménage : la liste active du logement + la quantité
   * relevée pour CE ménage (null si pas encore saisie).
   */
  async getMenageConsommables(
    menageId: string,
    logementId: string,
  ): Promise<MenageConsommableLine[]> {
    const rows = (await this.db('logement_consommable as c')
      .leftJoin('menage_consommable_releve as r', function () {
        this.on('r.logement_consommable_id', '=', 'c.id').andOnVal('r.menage_id', '=', menageId);
      })
      .where('c.logement_id', logementId)
      .whereNull('c.archived_at')
      .orderBy('c.position', 'asc')
      .orderBy('c.label', 'asc')
      .select(
        'c.id as logement_consommable_id',
        'c.label',
        'c.unit',
        'c.seuil_alerte',
        'c.position',
        'r.qty',
      )) as Array<{
      logement_consommable_id: string;
      label: string;
      unit: string | null;
      seuil_alerte: number;
      position: number;
      qty: number | null;
    }>;
    return rows.map((r) => ({
      ...r,
      qty: r.qty === null ? null : Number(r.qty),
      needs_restock: r.qty !== null && Number(r.qty) <= r.seuil_alerte,
    }));
  }

  /**
   * Upsert du relevé d'un ménage (un pointage de fin). Valide que chaque
   * consommable appartient bien au logement du ménage et est actif.
   */
  async setReleve(
    menageId: string,
    logementId: string,
    userId: string,
    items: { logement_consommable_id: string; qty: number }[],
  ): Promise<MenageConsommableLine[]> {
    const valid = await this.db('logement_consommable')
      .where({ logement_id: logementId })
      .whereNull('archived_at')
      .pluck('id');
    const validSet = new Set(valid as string[]);
    const rows = items
      .filter((it) => validSet.has(it.logement_consommable_id))
      .map((it) => ({
        menage_id: menageId,
        logement_consommable_id: it.logement_consommable_id,
        qty: it.qty,
        recorded_by: userId,
        recorded_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      }));
    if (rows.length > 0) {
      await this.db('menage_consommable_releve')
        .insert(rows)
        .onConflict(['menage_id', 'logement_consommable_id'])
        .merge(['qty', 'recorded_by', 'recorded_at', 'updated_at']);
    }
    return this.getMenageConsommables(menageId, logementId);
  }
}

/**
 * Pour une liste de logements, renvoie une Map logement_id → nombre de
 * consommables en alerte (stock courant <= seuil). Le stock courant = le
 * relevé le plus récent de chaque consommable. Sert au badge "à racheter".
 */
export async function computeConsommableAlerts(
  db: Knex,
  logementIds: string[],
): Promise<Map<string, number>> {
  if (logementIds.length === 0) return new Map();
  const result = (await db.raw(
    `SELECT c.logement_id,
            COUNT(*) FILTER (WHERE latest.qty <= c.seuil_alerte) AS n_alert
     FROM logement_consommable c
     JOIN LATERAL (
       SELECT r.qty
       FROM menage_consommable_releve r
       WHERE r.logement_consommable_id = c.id
       ORDER BY r.recorded_at DESC
       LIMIT 1
     ) latest ON true
     WHERE c.archived_at IS NULL AND c.logement_id = ANY(?)
     GROUP BY c.logement_id`,
    [logementIds],
  )) as { rows: { logement_id: string; n_alert: string }[] };
  const map = new Map<string, number>();
  for (const row of result.rows) {
    const n = Number(row.n_alert);
    if (n > 0) map.set(row.logement_id, n);
  }
  return map;
}

export default LogementConsommableService;
