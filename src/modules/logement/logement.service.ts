import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { LogementRow } from './logement.schema';

class LogementService extends BaseService<LogementRow> {
  constructor(db: Knex) {
    super(db, 'logement');
  }

  /**
   * Liste les logements actifs de l'org. Si `restrictToMemberUserId` est passé,
   * on ne renvoie que les logements où ce user est `logement_member` (utile
   * pour les non-admins qui ne doivent voir que leurs logements affiliés).
   */
  async findActiveByOrg(
    organizationId: string,
    options: PaginationOptions = {},
    restrictToMemberUserId?: string,
  ): Promise<PaginatedResult<LogementRow>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('logement')
      .where({ 'logement.organization_id': organizationId })
      .whereNull('logement.archived_at');

    if (restrictToMemberUserId) {
      baseQuery.whereExists(function () {
        this.select('*')
          .from('logement_member')
          .whereRaw('logement_member.logement_id = logement.id')
          .where('logement_member.user_id', restrictToMemberUserId);
      });
    }

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = (await baseQuery
      .clone()
      .select('logement.*')
      .orderBy(`logement.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit)) as LogementRow[];

    return {
      data,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /**
   * Archive un logement **en cascade** : le logement lui-même, toutes ses
   * prestations (ménages/check-in/check-out) encore actives et ses
   * consommables. Le tout dans une transaction pour rester cohérent.
   * Retourne le logement archivé + le nombre de prestations archivées.
   */
  async archive(
    id: string,
  ): Promise<{ logement: LogementRow | undefined; archivedMenages: number }> {
    const now = new Date();
    return this.db.transaction(async (trx) => {
      const [logement] = (await trx('logement')
        .where({ id })
        .whereNull('archived_at')
        .update({ archived_at: now, updated_at: now })
        .returning('*')) as LogementRow[];

      // Déjà archivé (ou introuvable) → rien à cascader.
      if (!logement) return { logement, archivedMenages: 0 };

      const archivedMenages = await trx('menage')
        .where({ logement_id: id })
        .whereNull('archived_at')
        .update({ archived_at: now, updated_at: now });

      await trx('logement_consommable')
        .where({ logement_id: id })
        .whereNull('archived_at')
        .update({ archived_at: now, updated_at: now });

      return { logement, archivedMenages };
    });
  }
}

export default LogementService;
