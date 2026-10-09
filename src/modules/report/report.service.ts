import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import { requireMenageAccess } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';
import { sendPushToUsers } from '@/lib/push';
import { CreateReport, ListReports, ReportRow, ReportWithContext, ResolveReport } from './report.schema';

/** Issue d'un signalement : créé, déjà ouvert, cible invisible, ou soi-même. */
export type SubmitResult =
  | { kind: 'created'; report: ReportRow }
  | { kind: 'duplicate'; report: ReportRow }
  | { kind: 'not_found' }
  | { kind: 'self' };

/** Ce qu'on a trouvé derrière la cible : où elle vit, qui en est responsable. */
type ResolvedTarget = {
  organization_id: string;
  menage_id: string | null;
  target_user_id: string | null;
  excerpt: string | null;
};

const EXCERPT_MAX = 300;

/**
 * Signalements (repris de Buildr) : un message, une photo ou un membre jugé
 * déplacé, remonté aux administrateurs de l'organisation.
 */
class ReportService extends BaseService<ReportRow> {
  constructor(db: Knex) {
    super(db, 'report');
  }

  private async canSeeMenage(userId: string, menageId: string, permission: 'view_comments' | 'view_photos'): Promise<boolean> {
    try {
      await requireMenageAccess(this.db, userId, menageId, permission);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrouve l'organisation, la prestation et la personne responsable d'une
   * cible, et vérifie que le rapporteur a bien accès à ce qu'il signale.
   * `null` si la cible n'existe pas ou ne lui est pas visible : on ne confirme
   * pas l'existence de ce qu'on n'a pas le droit de voir.
   */
  async resolveTarget(data: CreateReport, reporterId: string): Promise<ResolvedTarget | null> {
    if (data.target_type === 'comment') {
      const row = await this.db('comment')
        .join('menage', 'menage.id', 'comment.menage_id')
        .where('comment.id', data.target_id)
        .select('comment.menage_id', 'comment.author_id', 'comment.content', 'menage.organization_id')
        .first();
      if (!row || !(await this.canSeeMenage(reporterId, row.menage_id, 'view_comments'))) return null;
      return {
        organization_id: row.organization_id,
        menage_id: row.menage_id,
        target_user_id: row.author_id,
        excerpt: String(row.content).slice(0, EXCERPT_MAX),
      };
    }
    if (data.target_type === 'photo') {
      const row = await this.db('photo')
        .leftJoin('menage', 'menage.id', 'photo.menage_id')
        .leftJoin('logement', 'logement.id', 'photo.logement_id')
        .where('photo.id', data.target_id)
        .select(
          'photo.menage_id',
          'photo.uploaded_by',
          'photo.caption',
          this.db.raw('coalesce(menage.organization_id, logement.organization_id) as organization_id'),
        )
        .first();
      if (!row) return null;
      if (row.menage_id) {
        if (!(await this.canSeeMenage(reporterId, row.menage_id, 'view_photos'))) return null;
      } else {
        // Photo de référence d'un logement : visible des membres de son organisation.
        const membership = await getActiveMembership(this.db, reporterId);
        if (membership?.organization_id !== row.organization_id) return null;
      }
      return {
        organization_id: row.organization_id,
        menage_id: row.menage_id,
        target_user_id: row.uploaded_by,
        excerpt: row.caption ? String(row.caption).slice(0, EXCERPT_MAX) : null,
      };
    }
    // user : il faut partager une organisation avec la personne visée. On
    // retient celle du rapporteur où elle est membre, active en priorité.
    const reporter = await this.db('user').where({ id: reporterId }).select('active_organization_id').first();
    const shared = (await this.db('organization_member as mine')
      .join('organization_member as theirs', 'theirs.organization_id', 'mine.organization_id')
      .where('mine.user_id', reporterId)
      .where('theirs.user_id', data.target_id)
      .select('mine.organization_id')) as { organization_id: string }[];
    if (shared.length === 0) return null;
    const organization_id =
      shared.find((s) => s.organization_id === reporter?.active_organization_id)?.organization_id ??
      shared[0].organization_id;
    const target = await this.db('user').where({ id: data.target_id }).select('first_name', 'last_name').first();
    return {
      organization_id,
      menage_id: null,
      target_user_id: data.target_id,
      excerpt: target ? `${target.first_name} ${target.last_name}` : null,
    };
  }

  /**
   * Crée le signalement et prévient les admins de l'organisation — jamais la
   * personne visée — ainsi que la console si c'est un admin qui est visé.
   * Re-signaler la même chose rend le signalement déjà ouvert.
   */
  async submit(data: CreateReport, reporterId: string, onNotifyError: (err: unknown) => void): Promise<SubmitResult> {
    const target = await this.resolveTarget(data, reporterId);
    if (!target) return { kind: 'not_found' };
    if (target.target_user_id === reporterId) return { kind: 'self' };

    const duplicate = await this.findPendingDuplicate(reporterId, data);
    if (duplicate) return { kind: 'duplicate', report: duplicate };

    const escalated = await this.isOrgAdmin(target.target_user_id, target.organization_id);
    const report = await this.create({
      organization_id: target.organization_id,
      menage_id: target.menage_id,
      reporter_id: reporterId,
      target_type: data.target_type,
      target_id: data.target_id,
      target_user_id: target.target_user_id,
      target_excerpt: target.excerpt,
      reason: data.reason,
      comment: data.comment || null,
      escalated,
    } as Partial<ReportRow>);

    (async () => {
      const recipients = new Set(await this.adminsToNotify(target.organization_id, [target.target_user_id, reporterId]));
      if (escalated) {
        for (const id of await this.superAdminIds()) {
          if (id !== reporterId && id !== target.target_user_id) recipients.add(id);
        }
      }
      if (recipients.size === 0) return;
      await sendPushToUsers(this.db, [...recipients], {
        title: 'Contenu signalé',
        body: (await this.placeLabel(target)) || 'Un contenu a été signalé',
        data: { report_id: report.id, type: 'content_report' },
      });
    })().catch(onNotifyError);

    return { kind: 'created', report };
  }

  /** La personne visée est-elle administratrice de cette organisation ? */
  async isOrgAdmin(userId: string | null, organizationId: string): Promise<boolean> {
    if (!userId) return false;
    const m = await this.db('organization_member').where({ user_id: userId, organization_id: organizationId }).first();
    return m?.role === 'admin';
  }

  /** Un signalement en attente du même rapporteur sur la même cible, s'il existe. */
  async findPendingDuplicate(reporterId: string, data: CreateReport): Promise<ReportRow | undefined> {
    return (await this.db(this.table)
      .where({ reporter_id: reporterId, target_type: data.target_type, target_id: data.target_id, status: 'pending' })
      .first()) as ReportRow | undefined;
  }

  /** Les administrateurs de l'organisation, hors la personne visée et le rapporteur. */
  async adminsToNotify(organizationId: string, exclude: (string | null)[]): Promise<string[]> {
    const rows = (await this.db('organization_member')
      .where({ organization_id: organizationId, role: 'admin' })
      .whereNotIn('user_id', exclude.filter((x): x is string => !!x))
      .select('user_id')) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  async superAdminIds(): Promise<string[]> {
    const rows = (await this.db('user').where({ is_super_admin: true, is_active: true }).select('id')) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Où vit la cible, en clair, pour la notification (« Villa des Oliviers »). */
  async placeLabel(target: ResolvedTarget): Promise<string> {
    if (target.menage_id) {
      const row = await this.db('menage')
        .join('logement', 'logement.id', 'menage.logement_id')
        .where('menage.id', target.menage_id)
        .select('logement.name')
        .first();
      if (row?.name) return row.name as string;
    }
    const org = await this.db('organization').where({ id: target.organization_id }).select('name').first();
    return (org?.name as string | undefined) ?? '';
  }

  /** Signalements d'une organisation. Celui qui les traite ne voit jamais ceux qui le visent. */
  async listForOrganization(
    organizationId: string,
    viewerId: string,
    filters: ListReports,
  ): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const base = this.db(this.table)
      .where('report.organization_id', organizationId)
      .where((qb) => qb.whereNull('report.target_user_id').orWhereNot('report.target_user_id', viewerId));
    return this.paginate(base, filters);
  }

  /** Tous les signalements, pour la console. */
  async listAll(
    filters: ListReports & { escalated?: boolean; organization_id?: string },
  ): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const base = this.db(this.table).modify((qb) => {
      if (filters.escalated) qb.where('report.escalated', true);
      if (filters.organization_id) qb.where('report.organization_id', filters.organization_id);
    });
    return this.paginate(base, filters);
  }

  private async paginate(
    base: Knex.QueryBuilder,
    filters: ListReports,
  ): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const { page, limit, status, menage_id } = filters;
    const filtered = base.clone().modify((qb) => {
      if (status) qb.where('report.status', status);
      if (menage_id) qb.where('report.menage_id', menage_id);
    });
    const [rows, [{ count }], [{ pending }]] = await Promise.all([
      filtered
        .clone()
        .join('user as reporter', 'reporter.id', 'report.reporter_id')
        .leftJoin('user as target', 'target.id', 'report.target_user_id')
        .leftJoin('menage', 'menage.id', 'report.menage_id')
        .leftJoin('logement', 'logement.id', 'menage.logement_id')
        .join('organization', 'organization.id', 'report.organization_id')
        .select(
          'report.*',
          'reporter.first_name as reporter_first_name',
          'reporter.last_name as reporter_last_name',
          'target.first_name as target_first_name',
          'target.last_name as target_last_name',
          'logement.name as logement_name',
          'menage.date_prevue as menage_date',
          'organization.name as organization_name',
        )
        .orderBy('report.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit) as Promise<Omit<ReportWithContext, 'target_exists'>[]>,
      filtered.clone().count('* as count') as Promise<{ count: string }[]>,
      base.clone().where('report.status', 'pending').count('* as pending') as Promise<{ pending: string }[]>,
    ]);

    const exists = await this.targetsStillExist(rows);
    return {
      data: rows.map((r) => ({ ...r, target_exists: exists.get(r.id) ?? true })),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
      counts: { pending: parseInt(pending, 10) },
    };
  }

  /** Un message ou une photo signalé a-t-il déjà été supprimé ? */
  private async targetsStillExist(
    rows: { id: string; target_type: string; target_id: string }[],
  ): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    for (const type of ['comment', 'photo'] as const) {
      const ids = rows.filter((r) => r.target_type === type).map((r) => r.target_id);
      if (ids.length === 0) continue;
      const found = new Set(((await this.db(type).whereIn('id', ids).select('id')) as { id: string }[]).map((r) => r.id));
      for (const r of rows) if (r.target_type === type) map.set(r.id, found.has(r.target_id));
    }
    return map;
  }

  /** Le rôle de `userId` dans l'organisation du signalement. */
  async roleIn(userId: string, organizationId: string): Promise<string | undefined> {
    const m = await this.db('organization_member').where({ user_id: userId, organization_id: organizationId }).first();
    return m?.role as string | undefined;
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const u = await this.db('user').where({ id: userId }).select('is_super_admin').first();
    return !!u?.is_super_admin;
  }

  async resolve(id: string, data: ResolveReport, resolverId: string): Promise<ReportRow | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .update({
        status: data.status,
        resolution_note: data.resolution_note ?? null,
        resolved_by: resolverId,
        resolved_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .returning('*');
    return row as ReportRow | undefined;
  }
}

export default ReportService;
