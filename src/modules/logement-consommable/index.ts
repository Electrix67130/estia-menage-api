import fp from 'fastify-plugin';
import { z } from 'zod';
import type { Knex } from 'knex';
import LogementConsommableService from './logement-consommable.service';
import {
  createLogementConsommableSchema,
  updateLogementConsommableSchema,
  setReleveSchema,
} from './logement-consommable.schema';
import { getActiveMembership } from '@/lib/active-membership';

const byLogementSchema = z.object({ logement_id: z.string().uuid() });
const uuidSchema = z.object({ id: z.string().uuid() });

async function assertLogementBelongsToOrg(
  db: Knex,
  logementId: string,
  orgId: string,
): Promise<boolean> {
  const row = await db('logement').where({ id: logementId, organization_id: orgId }).first();
  return Boolean(row);
}

export default fp(
  (fastify, _opts, done) => {
    const service = new LogementConsommableService(fastify.db);

    // GET /logement-consommables?logement_id= — liste + stock courant + alerte
    fastify.get(
      '/logement-consommables',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = byLogementSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        const ok = await assertLogementBelongsToOrg(fastify.db, logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Logement not found');
        return service.findByLogementWithStock(logement_id);
      },
    );

    // POST /logement-consommables — admin
    fastify.post('/logement-consommables', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createLogementConsommableSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, data.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Logement not found');
      const row = await service.create(data);
      return reply.code(201).send(row);
    });

    // PATCH /logement-consommables/:id — admin
    fastify.patch('/logement-consommables/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateLogementConsommableSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Consommable not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Consommable not found');
      return service.update(id, data);
    });

    // DELETE /logement-consommables/:id — admin (soft-delete)
    fastify.delete('/logement-consommables/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Consommable not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
      if (!ok) return reply.notFound('Consommable not found');
      await service.archive(id);
      return reply.code(204).send();
    });

    // GET /menages/:id/consommables — liste du logement + relevé de CE ménage
    fastify.get('/menages/:id/consommables', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const menage = await fastify.db('menage').where({ id }).first();
      if (!menage) return reply.notFound('Menage not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership || menage.organization_id !== membership.organization_id) {
        return reply.notFound('Menage not found');
      }
      return service.getMenageConsommables(id, menage.logement_id);
    });

    // PUT /menages/:id/consommables — relevé au pointage de fin
    // (prestataire assigné OU admin)
    fastify.put('/menages/:id/consommables', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const { items } = setReleveSchema.parse(request.body);
      const menage = await fastify.db('menage').where({ id }).first();
      if (!menage) return reply.notFound('Menage not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership || menage.organization_id !== membership.organization_id) {
        return reply.notFound('Menage not found');
      }
      const isAssigned = menage.prestataire_user_id === request.user.sub;
      if (!isAssigned && membership.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Seul le prestataire assigné ou un admin peut relever les consommables',
        });
      }
      const data = await service.setReleve(id, menage.logement_id, request.user.sub, items);
      return { data };
    });

    done();
  },
  { name: 'logement-consommable-module' },
);
