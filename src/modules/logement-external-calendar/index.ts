import fp from 'fastify-plugin';
import { z } from 'zod';
import LogementExternalCalendarService from './logement-external-calendar.service';
import {
  createExternalCalendarSchema,
  updateExternalCalendarSchema,
} from './logement-external-calendar.schema';
import { getActiveMembership } from '@/lib/active-membership';

const uuidSchema = z.object({ id: z.string().uuid() });
const byLogementSchema = z.object({ logement_id: z.string().uuid() });

/**
 * Endpoints pour configurer les calendriers iCal externes (Airbnb, Booking,
 * Vrbo) attachés à un logement. Admin only — c'est lui qui colle l'URL
 * publique du calendrier et qui déclenche les sync manuelles.
 *
 * Le sync automatique tourne dans le worker (`src/lib/ical-worker.ts`)
 * démarré au boot du serveur.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new LogementExternalCalendarService(fastify.db);

    // GET /logement-external-calendars?logement_id=…
    fastify.get(
      '/logement-external-calendars',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = byLogementSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: logement_id }).first();
        if (!membership || !logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Logement not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const data = await service.findByLogement(logement_id);
        return { data };
      },
    );

    // POST /logement-external-calendars — admin
    fastify.post(
      '/logement-external-calendars',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createExternalCalendarSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: data.logement_id }).first();
        if (!membership || !logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Logement not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const row = await service.create(data);
        return reply.code(201).send(row);
      },
    );

    // PATCH /logement-external-calendars/:id — admin
    fastify.patch(
      '/logement-external-calendars/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateExternalCalendarSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Calendar not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: existing.logement_id }).first();
        if (!membership || !logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Calendar not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const updated = await service.update(id, data);
        return updated;
      },
    );

    // DELETE /logement-external-calendars/:id — admin
    fastify.delete(
      '/logement-external-calendars/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Calendar not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: existing.logement_id }).first();
        if (!membership || !logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Calendar not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        await service.delete(id);
        return reply.code(204).send();
      },
    );

    // POST /logement-external-calendars/:id/sync — manual sync (admin)
    fastify.post(
      '/logement-external-calendars/:id/sync',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const cal = await service.findById(id);
        if (!cal) return reply.notFound('Calendar not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: cal.logement_id }).first();
        if (!membership || !logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Calendar not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const result = await service.syncCalendar(cal);
        return { ...result, calendar: await service.findById(id) };
      },
    );

    done();
  },
  { name: 'logement-external-calendar-module' },
);
