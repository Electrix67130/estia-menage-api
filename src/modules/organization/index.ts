import fp from 'fastify-plugin';
import OrganizationService from './organization.service';
import { createOrganizationSchema, updateOrganizationSchema } from './organization.schema';
import { getActiveMembership } from '@/lib/active-membership';

export default fp(
  (fastify, _opts, done) => {
    const service = new OrganizationService(fastify.db);

    // GET /organization — retourne l'org active de l'utilisateur courant
    fastify.get('/organization', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const org = await service.findByUser(request.user.sub);
      if (!org) return reply.notFound('Organisation non trouvée');
      return org;
    });

    // PATCH /organization — admin uniquement (sur l'org active)
    fastify.patch('/organization', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = updateOrganizationSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return reply.notFound('Organisation non trouvée');
      if (membership.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: "Seul un administrateur peut modifier l'organisation",
        });
      }
      const updated = await service.update(membership.organization_id, data);
      return updated;
    });

    // POST /organizations — cree une nouvelle organisation, le createur en devient admin et la set active
    fastify.post('/organizations', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createOrganizationSchema.parse(request.body);
      const created = await service.createWithAdmin(data, request.user.sub);
      return reply.code(201).send(created);
    });

    done();
  },
  { name: 'organization-module' },
);
