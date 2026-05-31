import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { LogementMemberRow, LogementMemberRole } from './logement-member.schema';

/** Default permissions per role */
export const DEFAULT_PERMISSIONS: Record<
  LogementMemberRole,
  Pick<
    LogementMemberRow,
    | 'can_view_comments'
    | 'can_view_photos'
    | 'can_view_checklist'
    | 'can_view_team'
    | 'can_edit'
    | 'can_view_prestataires'
    | 'can_view_responsables'
    | 'can_view_clients'
  >
> = {
  manager: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_checklist: true,
    can_view_team: true,
    can_edit: true,
    can_view_prestataires: true,
    can_view_responsables: true,
    can_view_clients: true,
  },
  prestataire: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_checklist: true,
    can_view_team: false,
    can_edit: false,
    // Prestataire = "discret" par défaut. L'admin peut élargir au cas par cas.
    can_view_prestataires: false,
    can_view_responsables: false,
    can_view_clients: false,
  },
  client_proprietaire: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_checklist: true,
    can_view_team: false,
    can_edit: false,
    can_view_prestataires: true,
    can_view_responsables: true,
    can_view_clients: true,
  },
};

class LogementMemberService extends BaseService<LogementMemberRow> {
  constructor(db: Knex) {
    super(db, 'logement_member');
  }

  async create(data: Partial<LogementMemberRow>): Promise<LogementMemberRow> {
    const role = (data.role as LogementMemberRole) || 'prestataire';
    const defaults = DEFAULT_PERMISSIONS[role];
    return super.create({ ...defaults, ...data });
  }

  async changeRole(
    id: string,
    role: LogementMemberRole,
    overrides: Partial<LogementMemberRow> = {},
  ): Promise<LogementMemberRow | undefined> {
    const defaults = DEFAULT_PERMISSIONS[role];
    return this.update(id, { role, ...defaults, ...overrides });
  }

  async findByLogement(
    logementId: string,
    options: PaginationOptions = {},
  ): Promise<
    PaginatedResult<
      LogementMemberRow & {
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        company_name?: string;
        avatar_url?: string | null;
      }
    >
  > {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'asc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'logement_member.user_id', 'user.id')
      .where('logement_member.logement_id', logementId);

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          'logement_member.*',
          'user.first_name',
          'user.last_name',
          'user.email',
          'user.phone',
          'user.company_name',
          'user.avatar_url',
        )
        .orderBy(`logement_member.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  async findOwnWithUser(
    userId: string,
    logementId: string,
  ): Promise<
    | (LogementMemberRow & {
        first_name: string;
        last_name: string;
        email: string;
        phone?: string;
        company_name?: string;
      })
    | null
  > {
    const row = await this.db(this.table)
      .join('user', 'logement_member.user_id', 'user.id')
      .where({
        'logement_member.logement_id': logementId,
        'logement_member.user_id': userId,
      })
      .select(
        'logement_member.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.phone',
        'user.company_name',
      )
      .first();
    return row ?? null;
  }

  async isMember(logementId: string, userId: string): Promise<LogementMemberRow | undefined> {
    return this.findOne({
      logement_id: logementId,
      user_id: userId,
    } as Partial<LogementMemberRow>);
  }
}

export default LogementMemberService;
