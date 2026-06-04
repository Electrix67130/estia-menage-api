import fp from 'fastify-plugin';
import { z } from 'zod';
import UserService from './user.service';
import { updateUserSchema } from './user.schema';
import { getUserOrganizationId } from '@/lib/org-scope';
import { getActiveMembership } from '@/lib/active-membership';

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Cap élevé : le dashboard charge la liste complète des users (filtres
  // ménages/calendrier, affectation) en un seul appel `/users?limit=200`.
  limit: z.coerce.number().int().min(1).max(500).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

// Fields that any user can update on their own profile
const SELF_EDITABLE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'avatar_url'] as const;
// Fields reserved to admins (role, is_active, company_name)
const ADMIN_ONLY_FIELDS = ['role', 'is_active', 'company_name'] as const;

export default fp(
  (fastify, _opts, done) => {
    const service = new UserService(fastify.db);

    // GET /users — visibility scoped by role:
    // - admin: all org users
    // - employee/client: menage co-members only
    fastify.get('/users', { preHandler: [fastify.authenticate] }, async (request) => {
      const pagination = paginationSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return { data: [], meta: { total: 0, page: 1, limit: 0, totalPages: 0 } };
      const orgId = membership.organization_id;

      if (membership.role === 'admin') {
        return service.findByOrganization(orgId, pagination);
      }

      return service.findCoMembers(request.user.sub, orgId, pagination);
    });

    // GET /users/search — within current user's organization
    fastify.get('/users/search', { preHandler: [fastify.authenticate] }, async (request) => {
      const { q, ...pagination } = searchSchema.parse(request.query);
      const orgId = await getUserOrganizationId(fastify.db, request.user.sub);
      return service.search({ query: q, organizationId: orgId, ...pagination });
    });

    // GET /users/:id
    fastify.get('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const user = await service.findById(id);
      if (!user) return reply.notFound('User not found');
      const { password_hash: _, ...safeUser } = user;
      return safeUser;
    });

    // PATCH /users/:id — self update OR admin for role/is_active
    fastify.patch('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateUserSchema.parse(request.body);

      const currentUser = await service.findById(request.user.sub);
      if (!currentUser) return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid user' });

      const targetUser = id === request.user.sub ? currentUser : await service.findById(id);
      if (!targetUser) return reply.notFound('User not found');

      const editorMembership = await getActiveMembership(fastify.db, request.user.sub);
      const isSelf = request.user.sub === id;
      const isAdmin = editorMembership?.role === 'admin';

      // Non-admins can only update themselves and only SELF_EDITABLE_FIELDS
      if (!isAdmin && !isSelf) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot modify other users' });
      }

      if (!isAdmin) {
        for (const field of ADMIN_ONLY_FIELDS) {
          if (field in data) {
            return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: `Only admins can modify '${field}'` });
          }
        }
      }

      const user = await service.update(id, data);
      if (!user) return reply.notFound('User not found');

      // Quand un admin change `company_name`, on propage à tous les membres de
      // l'org + au nom de l'organisation elle-même.
      if (isAdmin && data.company_name && editorMembership?.organization_id) {
        const orgId = editorMembership.organization_id;
        const members = (await fastify.db('organization_member')
          .where({ organization_id: orgId })
          .select('user_id')) as { user_id: string }[];
        if (members.length > 0) {
          await fastify.db('user')
            .whereIn('id', members.map((m) => m.user_id))
            .update({ company_name: data.company_name });
        }
        await fastify.db('organization')
          .where('id', orgId)
          .update({ name: data.company_name });
      }

      const { password_hash: _, ...safeUser } = user;
      return safeUser;
    });

    // DELETE /users/:id — admin only
    fastify.delete('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const { id } = uuidSchema.parse(request.params);
      const deleted = await service.delete(id);
      if (!deleted) return reply.notFound('User not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'user-module' },
);
