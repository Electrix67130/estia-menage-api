import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { OrganizationMemberRow, MembershipWithOrg, UserRole } from './organization-member.schema';

class OrganizationMemberService extends BaseService<OrganizationMemberRow> {
  constructor(db: Knex) {
    super(db, 'organization_member');
  }

  /** Toutes les memberships d'un user, avec le nom de l'org (pour le picker). */
  async findByUser(userId: string): Promise<MembershipWithOrg[]> {
    return (await this.db('organization_member')
      .join('organization', 'organization_member.organization_id', 'organization.id')
      .where('organization_member.user_id', userId)
      .select(
        'organization_member.*',
        'organization.name as organization_name',
      )
      .orderBy('organization.name', 'asc')) as MembershipWithOrg[];
  }

  /** Membership specifique d'un user dans une org. */
  async findByUserAndOrg(userId: string, organizationId: string): Promise<OrganizationMemberRow | undefined> {
    return (await this.db('organization_member')
      .where({ user_id: userId, organization_id: organizationId })
      .first()) as OrganizationMemberRow | undefined;
  }

  /** Cree (ou ignore si existe) une membership. */
  async addMember(
    organizationId: string,
    userId: string,
    role: UserRole,
  ): Promise<OrganizationMemberRow | undefined> {
    const [row] = await this.db('organization_member')
      .insert({ organization_id: organizationId, user_id: userId, role })
      .onConflict(['organization_id', 'user_id'])
      .ignore()
      .returning('*');
    return row as OrganizationMemberRow | undefined;
  }
}

export default OrganizationMemberService;
