import fp from 'fastify-plugin';
import { z } from 'zod';
import LogementRoomService from './logement-room.service';
import {
  createLogementRoomSchema,
  updateLogementRoomSchema,
} from './logement-room.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { signFields, signUrlsInList } from '@/lib/sign-url';

const byLogementSchema = z.object({ logement_id: z.string().uuid() });
const uuidSchema = z.object({ id: z.string().uuid() });

async function assertLogementBelongsToOrg(
  db: import('knex').Knex,
  logementId: string,
  orgId: string,
): Promise<boolean> {
  const row = await db('logement').where({ id: logementId, organization_id: orgId }).first();
  return Boolean(row);
}

export default fp(
  (fastify, _opts, done) => {
    const service = new LogementRoomService(fastify.db);

    // GET /logement-rooms?logement_id=xxx
    fastify.get(
      '/logement-rooms',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = byLogementSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        const ok = await assertLogementBelongsToOrg(fastify.db, logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Logement not found');
        return signUrlsInList(await service.findByLogement(logement_id), ['photo_url']);
      },
    );

    // GET /logement-rooms/:id
    fastify.get(
      '/logement-rooms/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const room = await service.findById(id);
        if (!room) return reply.notFound('Room not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return reply.notFound('Room not found');
        const ok = await assertLogementBelongsToOrg(fastify.db, room.logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Room not found');
        return signFields(room, ['photo_url']);
      },
    );

    // POST /logement-rooms — admin
    fastify.post('/logement-rooms', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createLogementRoomSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, data.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Logement not found');
      const row = await service.create(data);
      return reply.code(201).send(signFields(row, ['photo_url']));
    });

    // PATCH /logement-rooms/:id — admin
    fastify.patch('/logement-rooms/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateLogementRoomSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Room not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Room not found');
      const updated = await service.update(id, data);
      return updated ? signFields(updated, ['photo_url']) : updated;
    });

    // DELETE /logement-rooms/:id — admin
    fastify.delete('/logement-rooms/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Room not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Room not found');
      await service.delete(id);
      return reply.code(204).send();
    });

    done();
  },
  { name: 'logement-room-module' },
);
