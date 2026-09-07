import fp from 'fastify-plugin';
import { z } from 'zod';
import LogementEquipementService from './logement-equipement.service';
import {
  EQUIPEMENT_CATALOG,
  EQUIPEMENT_CATEGORY_LABELS,
  bulkCreateLogementEquipementSchema,
  createLogementEquipementSchema,
  updateLogementEquipementSchema,
} from './logement-equipement.schema';
import { getActiveMembership } from '@/lib/active-membership';

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

/**
 * Inventaire des équipements d'un logement. Lecture pour tous les membres de
 * l'org (le prestataire doit savoir ce qu'il y a sur place), écriture admin.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new LogementEquipementService(fastify.db);

    // GET /logement-equipements/catalog — suggestions partagées dashboard/mobile.
    // Déclaré avant `/:id` pour ne pas être capté par la route paramétrée.
    fastify.get(
      '/logement-equipements/catalog',
      { preHandler: [fastify.authenticate] },
      async () => ({
        categories: Object.entries(EQUIPEMENT_CATEGORY_LABELS).map(([key, label]) => ({
          key,
          label,
          suggestions: EQUIPEMENT_CATALOG[key as keyof typeof EQUIPEMENT_CATALOG],
        })),
      }),
    );

    // GET /logement-equipements?logement_id=xxx
    fastify.get(
      '/logement-equipements',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = byLogementSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        const ok = await assertLogementBelongsToOrg(
          fastify.db,
          logement_id,
          membership.organization_id,
        );
        if (!ok) return reply.notFound('Logement not found');
        return service.findByLogement(logement_id);
      },
    );

    // POST /logement-equipements — admin
    fastify.post(
      '/logement-equipements',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createLogementEquipementSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(
          fastify.db,
          data.logement_id,
          membership.organization_id,
        );
        if (!ok) return reply.notFound('Logement not found');
        return reply.code(201).send(await service.createForLogement(data));
      },
    );

    // POST /logement-equipements/bulk — admin (ajout groupé depuis le catalogue)
    fastify.post(
      '/logement-equipements/bulk',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = bulkCreateLogementEquipementSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(
          fastify.db,
          data.logement_id,
          membership.organization_id,
        );
        if (!ok) return reply.notFound('Logement not found');
        return reply.code(201).send(await service.bulkCreate(data));
      },
    );

    // PATCH /logement-equipements/:id — admin
    fastify.patch(
      '/logement-equipements/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateLogementEquipementSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Equipement not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(
          fastify.db,
          existing.logement_id,
          membership.organization_id,
        );
        if (!ok) return reply.notFound('Equipement not found');
        return service.update(id, data);
      },
    );

    // DELETE /logement-equipements/:id — admin
    fastify.delete(
      '/logement-equipements/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Equipement not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(
          fastify.db,
          existing.logement_id,
          membership.organization_id,
        );
        if (!ok) return reply.notFound('Equipement not found');
        await service.delete(id);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'logement-equipement-module' },
);
