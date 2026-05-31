import fp from 'fastify-plugin';
import { z } from 'zod';
import LogementMemberService from './logement-member.service';
import {
  createLogementMemberSchema,
  updateLogementMemberSchema,
} from './logement-member.schema';
import { hasPermissionForLogement } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';

const byLogementSchema = z.object({
  logement_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

/**
 * Admin de l'org OU créateur du logement OU manager (membre du logement)
 * peut ajouter/retirer des membres.
 */
async function canManageMembers(
  db: import('knex').Knex,
  userId: string,
  logementId: string,
): Promise<boolean> {
  const m = await getActiveMembership(db, userId);
  if (m?.role === 'admin') return true;

  const logement = await db('logement').where({ id: logementId }).select('created_by').first();
  if (logement?.created_by === userId) return true;

  const member = await db('logement_member')
    .where({ logement_id: logementId, user_id: userId })
    .select('role', 'can_edit')
    .first();
  if (!member) return false;
  return member.role === 'manager' || !!member.can_edit;
}

export default fp(
  (fastify, _opts, done) => {
    const service = new LogementMemberService(fastify.db);

    // GET /logement-members/by-logement
    fastify.get(
      '/logement-members/by-logement',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id, ...pagination } = byLogementSchema.parse(request.query);
        const canViewAll = await hasPermissionForLogement(
          fastify.db,
          request.user.sub,
          logement_id,
          'view_team',
        );
        if (canViewAll) return service.findByLogement(logement_id, pagination);

        const ownRow = await service.findOwnWithUser(request.user.sub, logement_id);
        if (!ownRow) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Pas membre de ce logement',
          });
        }
        return { data: [ownRow], meta: { total: 1, page: 1, limit: 1, totalPages: 1 } };
      },
    );

    // POST /logement-members
    fastify.post(
      '/logement-members',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createLogementMemberSchema.parse(request.body);
        const can = await canManageMembers(fastify.db, request.user.sub, data.logement_id);
        if (!can) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Insufficient permissions to manage members',
          });
        }
        const logement = await fastify.db('logement').where({ id: data.logement_id }).first();
        const userToAdd = await fastify.db('user').where({ id: data.user_id }).first();
        if (!logement || !userToAdd) return reply.notFound('Logement or user not found');

        const targetMembership = await fastify.db('organization_member')
          .where({ user_id: data.user_id, organization_id: logement.organization_id })
          .first();
        if (!targetMembership) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: "Cet utilisateur n'appartient pas à votre organisation",
          });
        }

        const existing = await fastify.db('logement_member')
          .where({ logement_id: data.logement_id, user_id: data.user_id })
          .first();
        if (existing) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Cet utilisateur est déjà membre du logement',
          });
        }

        const member = await service.create(data);
        return reply.code(201).send(member);
      },
    );

    // PATCH /logement-members/:id — admin / créateur uniquement
    fastify.patch(
      '/logement-members/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateLogementMemberSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Member not found');

        const m = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement')
          .where({ id: existing.logement_id })
          .select('created_by')
          .first();
        const isAdminOrCreator =
          m?.role === 'admin' || logement?.created_by === request.user.sub;
        if (!isAdminOrCreator) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Only admins can edit member permissions',
          });
        }

        const member =
          data.role && data.role !== existing.role
            ? await service.changeRole(id, data.role, data)
            : await service.update(id, data);
        return member;
      },
    );

    // DELETE /logement-members/:id
    fastify.delete(
      '/logement-members/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Member not found');

        const can = await canManageMembers(fastify.db, request.user.sub, existing.logement_id);
        if (!can) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Insufficient permissions to manage members',
          });
        }

        await service.delete(id);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'logement-member-module' },
);
