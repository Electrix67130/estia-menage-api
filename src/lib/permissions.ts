import { Knex } from 'knex';

export type Permission =
  | 'view_comments'
  | 'view_photos'
  | 'view_checklist'
  | 'view_team'
  | 'edit';

const PERMISSION_COLUMN: Record<Permission, string> = {
  view_comments: 'can_view_comments',
  view_photos: 'can_view_photos',
  view_checklist: 'can_view_checklist',
  view_team: 'can_view_team',
  edit: 'can_edit',
};

/**
 * Check if a user has a specific permission on a logement.
 * Admins (organization_member.role = 'admin') always pass.
 * The logement creator (created_by) always passes.
 * Otherwise, checks logement_member flags.
 */
export async function hasPermissionForLogement(
  db: Knex,
  userId: string,
  logementId: string,
  permission: Permission,
): Promise<boolean> {
  // Admin bypass — base sur la membership active du user
  const activeMember = await db('user')
    .leftJoin('organization_member', function () {
      this.on('organization_member.user_id', '=', 'user.id').andOn(
        'organization_member.organization_id',
        '=',
        'user.active_organization_id',
      );
    })
    .where('user.id', userId)
    .select('organization_member.role as role')
    .first();
  if (activeMember?.role === 'admin') return true;

  // Logement creator bypass
  const logement = await db('logement').where({ id: logementId }).select('created_by').first();
  if (!logement) return false;
  if (logement.created_by === userId) return true;

  // Check member permissions
  const member = await db('logement_member')
    .where({ logement_id: logementId, user_id: userId })
    .select(PERMISSION_COLUMN[permission])
    .first();

  return !!member?.[PERMISSION_COLUMN[permission]];
}

export async function requirePermissionForLogement(
  db: Knex,
  userId: string,
  logementId: string,
  permission: Permission,
): Promise<void> {
  const ok = await hasPermissionForLogement(db, userId, logementId, permission);
  if (!ok) {
    throw Object.assign(new Error('Forbidden: insufficient permissions'), { statusCode: 403 });
  }
}

/**
 * Helper qui résout le logement_id depuis un menage_id puis applique la permission.
 * Usage typique : un module (photo, comment, menage-check) qui travaille sur des
 * entités liées à un ménage doit checker les permissions du logement parent.
 */
export async function hasPermissionForMenage(
  db: Knex,
  userId: string,
  menageId: string,
  permission: Permission,
): Promise<boolean> {
  const menage = await db('menage').where({ id: menageId }).select('logement_id').first();
  if (!menage) return false;
  return hasPermissionForLogement(db, userId, menage.logement_id, permission);
}

export async function requirePermissionForMenage(
  db: Knex,
  userId: string,
  menageId: string,
  permission: Permission,
): Promise<void> {
  const ok = await hasPermissionForMenage(db, userId, menageId, permission);
  if (!ok) {
    throw Object.assign(new Error('Forbidden: insufficient permissions'), { statusCode: 403 });
  }
}
