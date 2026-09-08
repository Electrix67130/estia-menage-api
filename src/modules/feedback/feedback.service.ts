import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import type { FeedbackRow, ListFeedback, RespondFeedback } from './feedback.schema';

/** Signalement enrichi de son auteur, pour la console admin. */
export type FeedbackWithAuthor = FeedbackRow & {
  author_email: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
  responder_first_name: string | null;
  responder_last_name: string | null;
  /** Renseigné par les vues super admin, qui traversent les organisations. */
  organization_name?: string | null;
};

class FeedbackService extends BaseService<FeedbackRow> {
  constructor(db: Knex) {
    super(db, 'feedback');
  }

  /** Les signalements d'un utilisateur, du plus récent au plus ancien. */
  async findByUser(
    userId: string,
    { page = 1, limit = 20 }: { page?: number; limit?: number },
  ): Promise<PaginatedResult<FeedbackRow>> {
    const [{ count }] = (await this.db('feedback')
      .where({ user_id: userId })
      .count('* as count')) as { count: string }[];
    const data = (await this.db('feedback')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)) as FeedbackRow[];

    const total = parseInt(count, 10);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Les signalements d'une organisation, pour ses admins.
   *
   * Le tri place les nouveaux en tête quel que soit leur âge : une console de
   * traitement se lit par ce qui reste à faire, pas par chronologie.
   */
  async findForOrg(
    organizationId: string,
    filters: ListFeedback,
  ): Promise<PaginatedResult<FeedbackWithAuthor>> {
    const { page, limit, status, type, q } = filters;

    const base = this.db('feedback')
      .leftJoin('user', 'user.id', 'feedback.user_id')
      .where('feedback.organization_id', organizationId)
      .modify((query) => {
        if (status) query.where('feedback.status', status);
        if (type) query.where('feedback.type', type);
        if (q) {
          const motif = `%${q}%`;
          query.where((sub) => {
            sub
              .whereILike('feedback.subject', motif)
              .orWhereILike('feedback.message', motif)
              .orWhereILike('user.email', motif);
          });
        }
      });

    const [{ count }] = (await base.clone().count('feedback.id as count')) as { count: string }[];

    const data = (await base
      .clone()
      .leftJoin({ responder: 'user' }, 'responder.id', 'feedback.responded_by')
      .select(
        'feedback.*',
        'user.email as author_email',
        'user.first_name as author_first_name',
        'user.last_name as author_last_name',
        'responder.first_name as responder_first_name',
        'responder.last_name as responder_last_name',
      )
      // `new` d'abord, puis `in_progress`, puis le reste : l'ordre de traitement.
      .orderByRaw(
        "CASE feedback.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, feedback.created_at DESC",
      )
      .limit(limit)
      .offset((page - 1) * limit)) as FeedbackWithAuthor[];

    const total = parseInt(count, 10);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Enregistre le traitement d'un signalement.
   *
   * Écrire une réponse fait passer le statut à `resolved` si l'appelant n'en a
   * pas précisé un : répondre, c'est traiter. L'admin peut toujours forcer un
   * autre statut dans la même requête.
   */
  async respond(
    id: string,
    data: RespondFeedback,
    responderId: string,
  ): Promise<FeedbackRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };

    if (data.status) patch.status = data.status;

    if (data.response !== undefined) {
      patch.response = data.response;
      if (data.response === null) {
        // Retrait de la réponse : on efface aussi qui l'avait écrite, sinon la
        // fiche affiche un répondant sans réponse.
        patch.responded_by = null;
        patch.responded_at = null;
      } else {
        patch.responded_by = responderId;
        patch.responded_at = new Date();
        if (!data.status) patch.status = 'resolved';
      }
    }

    const [row] = (await this.db('feedback')
      .where({ id })
      .update(patch)
      .returning('*')) as FeedbackRow[];
    return row;
  }

  /**
   * Tous les signalements, toutes organisations : console super admin.
   * Même tri que la vue org — ce qui reste à traiter d'abord.
   */
  async findForSupport(filters: ListFeedback): Promise<PaginatedResult<FeedbackWithAuthor>> {
    const { page, limit, status, type, q } = filters;

    const base = this.db('feedback')
      .leftJoin('user', 'user.id', 'feedback.user_id')
      .modify((query) => {
        if (status) query.where('feedback.status', status);
        if (type) query.where('feedback.type', type);
        if (q) {
          const motif = `%${q}%`;
          query.where((sub) => {
            sub
              .whereILike('feedback.subject', motif)
              .orWhereILike('feedback.message', motif)
              .orWhereILike('user.email', motif);
          });
        }
      });

    const [{ count }] = (await base.clone().count('feedback.id as count')) as { count: string }[];

    const data = (await base
      .clone()
      .leftJoin('organization', 'organization.id', 'feedback.organization_id')
      .leftJoin({ responder: 'user' }, 'responder.id', 'feedback.responded_by')
      .select(
        'feedback.*',
        'user.email as author_email',
        'user.first_name as author_first_name',
        'user.last_name as author_last_name',
        'organization.name as organization_name',
        'responder.first_name as responder_first_name',
        'responder.last_name as responder_last_name',
      )
      .orderByRaw(
        "CASE feedback.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, feedback.created_at DESC",
      )
      .limit(limit)
      .offset((page - 1) * limit)) as FeedbackWithAuthor[];

    const total = parseInt(count, 10);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Un signalement avec son auteur et son org, pour la fiche super admin. */
  async findByIdForSupport(id: string): Promise<FeedbackWithAuthor | undefined> {
    return this.db('feedback')
      .leftJoin('user', 'user.id', 'feedback.user_id')
      .leftJoin('organization', 'organization.id', 'feedback.organization_id')
      .leftJoin({ responder: 'user' }, 'responder.id', 'feedback.responded_by')
      .where('feedback.id', id)
      .select(
        'feedback.*',
        'user.email as author_email',
        'user.first_name as author_first_name',
        'user.last_name as author_last_name',
        'organization.name as organization_name',
        'responder.first_name as responder_first_name',
        'responder.last_name as responder_last_name',
      )
      .first() as Promise<FeedbackWithAuthor | undefined>;
  }

  /**
   * Compte par statut, pour la pastille « à traiter ».
   * Sans `organizationId` : toutes organisations (console super admin).
   */
  async countByStatus(organizationId?: string): Promise<Record<string, number>> {
    const rows = (await this.db('feedback')
      .modify((q) => {
        if (organizationId) q.where({ organization_id: organizationId });
      })
      .select('status')
      .count('* as count')
      .groupBy('status')) as { status: string; count: string }[];
    return Object.fromEntries(rows.map((r) => [r.status, parseInt(r.count, 10)]));
  }
}

export default FeedbackService;
