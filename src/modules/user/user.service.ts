import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { UserRow } from './user.schema';
import { signUrlsInList } from '@/lib/sign-url';

const USER_PUBLIC_COLS = [
  'user.id',
  'user.email',
  'user.first_name',
  'user.last_name',
  'user.phone',
  'user.avatar_url',
  'user.company_name',
  'user.is_active',
  'user.created_at',
  'user.updated_at',
];

class UserService extends BaseService<UserRow> {
  constructor(db: Knex) {
    super(db, 'user');
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    return this.findOne({ email } as Partial<UserRow>);
  }

  /**
   * Liste les users qui ont une membership dans l'organisation donnee.
   * Le `role` retourne est celui de la membership dans cette org (pas le legacy user.role).
   * `organization_id` retourne l'org filtrante (pour compat avec l'ancien shape).
   */
  async findByOrganization(
    organizationId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId);

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy(`user.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: signUrlsInList(data, ['avatar_url']),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  async search({
    query,
    organizationId,
    page = 1,
    limit = 20,
  }: {
    query: string;
    organizationId: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId)
      .where(function () {
        this.whereILike('user.first_name', `%${query}%`)
          .orWhereILike('user.last_name', `%${query}%`)
          .orWhereILike('user.email', `%${query}%`)
          .orWhereILike('user.company_name', `%${query}%`);
      })
      .where('user.is_active', true);

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy('user.last_name', 'asc')
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: signUrlsInList(data, ['avatar_url']),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  /**
   * Return only users who share at least one logement with the given user.
   * Used for employee/client visibility scoping.
   */
  async findCoMembers(
    userId: string,
    organizationId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId)
      .whereExists(function () {
        this.select('*')
          .from('logement_member as cm1')
          .join('logement_member as cm2', 'cm1.logement_id', 'cm2.logement_id')
          .whereRaw('cm2.user_id = "user".id')
          .where('cm1.user_id', userId)
          .whereRaw('cm2.user_id != cm1.user_id');
      });

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy(`user.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: signUrlsInList(data, ['avatar_url']),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

}

export default UserService;
