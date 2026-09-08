import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Knex } from 'knex';

/**
 * Garde des routes `/super-admin/*` : 403 si l'utilisateur n'est pas super admin.
 *
 * Le drapeau `user.is_super_admin` se pose **à la main en SQL** : aucune route
 * ne l'accorde, sinon une élévation de privilèges se ferait via l'API.
 */
export function requireSuperAdmin(fastify: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await fastify
      .db('user')
      .where({ id: request.user.sub })
      .select('is_super_admin')
      .first();
    if (!user?.is_super_admin) {
      return reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Super admin only',
      });
    }
  };
}

interface AuditLogParams {
  super_admin_id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Trace une action de super admin. Agir sur les données de quelqu'un d'autre
 * doit rester attribuable — c'est la contrepartie du privilège.
 */
export async function logAudit(db: Knex, params: AuditLogParams): Promise<void> {
  await db('audit_log').insert({
    super_admin_id: params.super_admin_id,
    action: params.action,
    target_type: params.target_type ?? null,
    target_id: params.target_id ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ip: params.ip ?? null,
  });
}
