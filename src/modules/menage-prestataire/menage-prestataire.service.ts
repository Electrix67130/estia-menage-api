import { Knex } from 'knex';
import { MenagePrestataireRow, MenagePrestataireWithUser } from './menage-prestataire.schema';

class MenagePrestataireService {
  constructor(private db: Knex) {}

  /**
   * Liste des prestataires affectés à un ménage, enrichis avec leurs infos
   * user. Le premier (par `created_at`) est marqué `is_primary: true`.
   */
  async findByMenage(menageId: string): Promise<MenagePrestataireWithUser[]> {
    const rows = (await this.db('menage_prestataire')
      .leftJoin('user', 'menage_prestataire.user_id', 'user.id')
      .where('menage_prestataire.menage_id', menageId)
      .orderBy('menage_prestataire.created_at', 'asc')
      .select(
        'menage_prestataire.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.avatar_url',
      )) as Omit<MenagePrestataireWithUser, 'is_primary'>[];
    return rows.map((r, idx) => ({ ...r, is_primary: idx === 0 }));
  }

  /**
   * Remplace intégralement la liste des prestataires affectés (full-replace).
   * Synchronise aussi `menage.prestataire_user_id` (denormalized) sur le
   * premier UUID de la liste (le "principal"), ou null si vide.
   *
   * Le tout dans une transaction pour garantir la cohérence join ↔ denorm.
   */
  async setMenagePrestataires(menageId: string, userIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      // 1. Snapshot des affectations actuelles pour préserver les `created_at`
      //    sur les rows conservées (sinon le réordonnancement perd le "primary").
      const existing = (await trx('menage_prestataire')
        .where({ menage_id: menageId })
        .select('user_id', 'created_at')) as { user_id: string; created_at: Date }[];
      const existingByUser = new Map(existing.map((r) => [r.user_id, r.created_at]));

      // 2. Remplace toute la liste : on supprime puis on ré-insère. Préserve
      //    `created_at` pour les users déjà présents (pour conserver l'ordre
      //    d'arrivée → le premier reste primary), et stamp `now` pour les
      //    nouveaux (qu'ils soient ajoutés en fin de liste).
      await trx('menage_prestataire').where({ menage_id: menageId }).del();

      if (userIds.length > 0) {
        // Si le user passé est le 1er de la liste, on stamp un timestamp
        // "ancien" pour qu'il devienne le primary (created_at le plus petit).
        // Stratégie simpliste : on utilise l'index pour ordonner via offsets ms.
        const now = Date.now();
        const rows = userIds.map((userId, idx) => ({
          menage_id: menageId,
          user_id: userId,
          created_at: existingByUser.get(userId) ?? new Date(now + idx),
        }));
        // On force le primary (idx=0) à avoir le created_at le plus ancien si
        // c'était déjà membre — sinon on le stamp avant tous les autres.
        if (rows.length > 0) {
          const primaryExisting = existingByUser.get(userIds[0]);
          rows[0].created_at = primaryExisting ?? new Date(now);
          for (let i = 1; i < rows.length; i++) {
            const u = userIds[i];
            const existed = existingByUser.get(u);
            rows[i].created_at = existed ?? new Date(now + i);
          }
        }
        await trx('menage_prestataire').insert(rows);
      }

      // 3. Sync denormalisé sur menage.prestataire_user_id
      const primary = userIds[0] ?? null;
      await trx('menage')
        .where({ id: menageId })
        .update({ prestataire_user_id: primary, updated_at: new Date() });
    });
  }

  /**
   * Ajoute un prestataire au ménage (idempotent). Si c'est le premier, il
   * devient automatiquement le primary. Ne touche pas aux autres.
   */
  async addPrestataire(menageId: string, userId: string): Promise<MenagePrestataireRow> {
    return this.db.transaction(async (trx) => {
      const existing = (await trx('menage_prestataire')
        .where({ menage_id: menageId, user_id: userId })
        .first()) as MenagePrestataireRow | undefined;
      if (existing) return existing;

      const [inserted] = (await trx('menage_prestataire')
        .insert({ menage_id: menageId, user_id: userId })
        .returning('*')) as MenagePrestataireRow[];

      // Si c'est le premier prestataire affecté → set primary denormalisé.
      const count = (await trx('menage_prestataire')
        .where({ menage_id: menageId })
        .count<{ count: string }[]>('* as count'))[0].count;
      if (parseInt(count, 10) === 1) {
        await trx('menage')
          .where({ id: menageId })
          .update({ prestataire_user_id: userId, updated_at: new Date() });
      }
      return inserted;
    });
  }

  /**
   * Retire un prestataire du ménage. Si c'était le primary, le suivant (par
   * created_at) devient primary. Si plus aucun, prestataire_user_id passe à null.
   */
  async removePrestataire(menageId: string, userId: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const deleted = await trx('menage_prestataire')
        .where({ menage_id: menageId, user_id: userId })
        .del();
      if (deleted === 0) return;

      // Re-calcule le primary à partir de la jointure (oldest created_at).
      const remaining = (await trx('menage_prestataire')
        .where({ menage_id: menageId })
        .orderBy('created_at', 'asc')
        .first()) as MenagePrestataireRow | undefined;

      await trx('menage')
        .where({ id: menageId })
        .update({
          prestataire_user_id: remaining?.user_id ?? null,
          updated_at: new Date(),
        });
    });
  }
}

export default MenagePrestataireService;
