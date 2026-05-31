import fp from 'fastify-plugin';
import PrestataireAvailabilityService from './prestataire-availability.service';
import {
  updateWeeklyAvailabilitySchema,
  listWeeklyAvailabilitySchema,
} from './prestataire-availability.schema';
import { getActiveMembership } from '@/lib/active-membership';

export default fp(
  (fastify, _opts, done) => {
    const service = new PrestataireAvailabilityService(fastify.db);

    // GET /prestataires/me/weekly-availability — sa propre dispo hebdo
    fastify.get(
      '/prestataires/me/weekly-availability',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        return service.findOrCreateForUser(request.user.sub, membership.organization_id);
      },
    );

    // PATCH /prestataires/me/weekly-availability — toggle d'un ou plusieurs jours
    fastify.patch(
      '/prestataires/me/weekly-availability',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = updateWeeklyAvailabilitySchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        return service.updateForUser(request.user.sub, membership.organization_id, data);
      },
    );

    // GET /prestataires/weekly-availability?user_ids=u1,u2 — admin only, lecture batch
    fastify.get(
      '/prestataires/weekly-availability',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { user_ids } = listWeeklyAvailabilitySchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const rows = await service.findByUserIds(membership.organization_id, user_ids);
        return { data: rows };
      },
    );

    done();
  },
  { name: 'prestataire-availability-module' },
);
