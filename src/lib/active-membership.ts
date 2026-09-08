import { Knex } from 'knex';

export interface ActiveMembership {
  organization_id: string;
  role: string;
}

/**
 * Recupere la membership active d'un user (organization_id + role dans cette org).
 * Renvoie null si l'user n'a pas d'org active (cas edge : user sans aucune membership).
 *
 * Une organisation **désactivée** par le super admin (`organization.is_active`
 * à false) ne rend plus de membership : sans ça le kill switch n'éteindrait
 * rien, puisque toutes les routes métier passent par ici.
 */
export async function getActiveMembership(
  db: Knex,
  userId: string,
): Promise<ActiveMembership | null> {
  const row = await db('user')
    .leftJoin('organization_member', function () {
      this.on('organization_member.user_id', '=', 'user.id').andOn(
        'organization_member.organization_id',
        '=',
        'user.active_organization_id',
      );
    })
    .leftJoin('organization', 'organization.id', 'user.active_organization_id')
    .where('user.id', userId)
    .select(
      'user.active_organization_id as organization_id',
      'organization_member.role as role',
      'organization.is_active as org_active',
    )
    .first();
  if (!row?.organization_id || !row.role) return null;
  if (row.org_active === false) return null;
  return { organization_id: row.organization_id, role: row.role };
}

/**
 * Helper qui throw 403 si pas de membership active. Utile dans les routes pour decoder
 * en une ligne.
 */
export async function requireActiveMembership(
  db: Knex,
  userId: string,
): Promise<ActiveMembership> {
  const membership = await getActiveMembership(db, userId);
  if (!membership) {
    throw Object.assign(new Error("Pas d'organisation active"), { statusCode: 403 });
  }
  return membership;
}
