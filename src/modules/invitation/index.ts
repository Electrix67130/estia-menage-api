import fp from 'fastify-plugin';
import { z } from 'zod';
import InvitationService from './invitation.service';
import { createInvitationSchema } from './invitation.schema';
import { getUserOrganizationId } from '@/lib/org-scope';
import { getActiveMembership } from '@/lib/active-membership';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const tokenParamSchema = z.object({ token: z.string().min(1) });
const uuidParamSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new InvitationService(fastify.db);

    // GET /invitations — list pending invitations (scoped to current org)
    fastify.get('/invitations', { preHandler: [fastify.authenticate] }, async (request) => {
      const query = paginationSchema.parse(request.query);
      const orgId = await getUserOrganizationId(fastify.db, request.user.sub);
      // Assainit les invitations orphelines (email déjà membre) avant de lister.
      await service.reconcileAccepted(orgId);
      const { page = 1, limit = 20 } = query;
      const baseQuery = fastify.db('invitation').where('organization_id', orgId);
      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];
      const data = await baseQuery.clone().select('*').orderBy('created_at', 'desc').limit(limit).offset((page - 1) * limit);
      return { data, meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) } };
    });

    // POST /invitations — invite a collaborator (admin only)
    fastify.post('/invitations', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only admins can invite' });
      }

      const data = createInvitationSchema.parse(request.body);
      const invitation = await service.invite(data, request.user.sub);
      return reply.code(201).send(invitation);
    });

    // POST /invitations/:id/resend — resend an invitation email (admin only, org-scoped)
    fastify.post('/invitations/:id/resend', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only admins can resend invitations' });
      }
      const existing = await service.findById(id);
      if (!existing || existing.organization_id !== membership.organization_id) {
        return reply.notFound('Invitation not found');
      }
      if (existing.status === 'accepted') {
        return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Cette invitation a déjà été acceptée' });
      }
      const updated = await service.resend(id);
      return updated;
    });

    // GET /invitations/by-token/:token — get invitation info (email + role + org) to prefill signup
    fastify.get('/invitations/by-token/:token', async (request, reply) => {
      const { token } = tokenParamSchema.parse(request.params);
      const invitation = await service.findByToken(token);
      if (!invitation) return reply.notFound('Invitation not found or already accepted');
      if (new Date(invitation.expires_at) < new Date()) {
        return reply.badRequest('Invitation expired');
      }
      const org = await fastify.db('organization').where({ id: invitation.organization_id }).first();
      return {
        email: invitation.email,
        role: invitation.role,
        organization_name: org?.name ?? '',
      };
    });

    // POST /invitations/:token/accept — accept an invitation (no auth required)
    fastify.post('/invitations/:token/accept', async (request, reply) => {
      const { token } = tokenParamSchema.parse(request.params);
      const invitation = await service.findByToken(token);
      if (!invitation) return reply.notFound('Invitation not found or expired');

      // Check if expired
      if (new Date(invitation.expires_at) < new Date()) {
        await service.accept(invitation.id);
        return reply.badRequest('Invitation has expired');
      }

      await service.accept(invitation.id);
      return { message: 'Invitation accepted', invitation };
    });

    // DELETE /invitations/:id — cancel an invitation
    fastify.delete('/invitations/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const deleted = await service.delete(id);
      if (!deleted) return reply.notFound('Invitation not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'invitation-module' },
);
