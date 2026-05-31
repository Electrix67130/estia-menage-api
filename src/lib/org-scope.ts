import { Knex } from 'knex';

/**
 * Get the active organization_id of the current user.
 * All queries should be scoped by this to ensure tenant isolation.
 */
export async function getUserOrganizationId(db: Knex, userId: string): Promise<string> {
  const user = await db('user').where({ id: userId }).select('active_organization_id').first();
  if (!user?.active_organization_id) {
    throw Object.assign(new Error('User has no active organization'), { statusCode: 403 });
  }
  return user.active_organization_id;
}
