import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import {
  RescheduleRequestRow,
  ListRescheduleRequestsQuery,
} from './menage-reschedule-request.schema';

class MenageRescheduleRequestService extends BaseService<RescheduleRequestRow> {
  constructor(db: Knex) {
    super(db, 'menage_reschedule_request');
  }

  async findFiltered(
    organizationId: string,
    options: ListRescheduleRequestsQuery,
  ): Promise<PaginatedResult<RescheduleRequestRow>> {
    const { status, menage_id, requested_by, page = 1, limit = 20 } = options;

    const baseQuery = this.db('menage_reschedule_request')
      .join('menage', 'menage_reschedule_request.menage_id', 'menage.id')
      .where('menage.organization_id', organizationId);

    if (status) baseQuery.where('menage_reschedule_request.status', status);
    if (menage_id) baseQuery.where('menage_reschedule_request.menage_id', menage_id);
    if (requested_by) baseQuery.where('menage_reschedule_request.requested_by', requested_by);

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = (await baseQuery
      .clone()
      .select('menage_reschedule_request.*')
      .orderBy('menage_reschedule_request.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)) as RescheduleRequestRow[];

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

  async decide(
    id: string,
    decision: 'approved' | 'rejected',
    deciderUserId: string,
    decisionReason?: string,
    applyToMenage?: boolean,
  ): Promise<RescheduleRequestRow | undefined> {
    return this.db.transaction(async (trx) => {
      const existing = (await trx('menage_reschedule_request')
        .where({ id })
        .first()) as RescheduleRequestRow | undefined;
      if (!existing || existing.status !== 'pending') return existing;

      const now = new Date();
      const [updated] = (await trx('menage_reschedule_request')
        .where({ id })
        .update({
          status: decision,
          decided_by: deciderUserId,
          decided_at: now,
          decision_reason: decisionReason ?? null,
          updated_at: now,
        })
        .returning('*')) as RescheduleRequestRow[];

      if (decision === 'approved' && applyToMenage !== false) {
        await trx('menage')
          .where({ id: existing.menage_id })
          .update({
            date_prevue: existing.proposed_date,
            horaire_prevu: existing.proposed_time,
            // Verrouille la date contre les écrasements par la sync iCal :
            // l'admin a explicitement validé un changement, c'est désormais la
            // source de vérité jusqu'à déverrouillage manuel.
            date_locked: true,
            updated_at: now,
          });
      }

      return updated;
    });
  }

  async cancel(
    id: string,
    cancelerUserId: string,
  ): Promise<RescheduleRequestRow | undefined> {
    const now = new Date();
    const [row] = (await this.db('menage_reschedule_request')
      .where({ id, status: 'pending' })
      .update({
        status: 'cancelled',
        decided_by: cancelerUserId,
        decided_at: now,
        updated_at: now,
      })
      .returning('*')) as RescheduleRequestRow[];
    return row;
  }
}

export default MenageRescheduleRequestService;
