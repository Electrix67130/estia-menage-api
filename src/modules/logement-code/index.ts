import fp from 'fastify-plugin';
import { Knex } from 'knex';
import { z } from 'zod';
import LogementCodeService from './logement-code.service';
import {
  CODE_LABEL_SUGGESTIONS,
  createLogementCodeSchema,
  updateLogementCodeSchema,
} from './logement-code.schema';
import { getActiveMembership } from '@/lib/active-membership';

const byLogementSchema = z.object({ logement_id: z.string().uuid() });
const uuidSchema = z.object({ id: z.string().uuid() });

async function logementInOrg(db: Knex, logementId: string, orgId: string): Promise<boolean> {
  const row = await db('logement').where({ id: logementId, organization_id: orgId }).first();
  return Boolean(row);
}

/**
 * Qui peut LIRE les codes d'accès d'un logement :
 *  - l'admin de l'org ;
 *  - un membre du logement (`logement_member`, quel que soit son rôle) ;
 *  - un prestataire affecté à un ménage de ce logement, même s'il n'en est pas
 *    membre (remplaçant sur une seule prestation) — sans le code, il ne peut
 *    pas entrer.
 */
async function canReadCodes(db: Knex, userId: string, logementId: string): Promise<boolean> {
  const member = await db('logement_member')
    .where({ logement_id: logementId, user_id: userId })
    .first();
  if (member) return true;

  const assigned = await db('menage')
    .leftJoin('menage_prestataire', 'menage_prestataire.menage_id', 'menage.id')
    .where('menage.logement_id', logementId)
    .andWhere((q) =>
      q.where('menage.prestataire_user_id', userId).orWhere('menage_prestataire.user_id', userId),
    )
    .first();
  return Boolean(assigned);
}

/**
 * Codes d'accès d'un logement (boîte à clés, portail, alarme…) : plusieurs
 * codes, chacun avec un libellé libre. Écriture admin, lecture pour ceux qui
 * doivent entrer dans le logement.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new LogementCodeService(fastify.db);

    // GET /logement-codes/label-suggestions — libellés proposés (dashboard + mobile)
    fastify.get(
      '/logement-codes/label-suggestions',
      { preHandler: [fastify.authenticate] },
      async () => ({ labels: [...CODE_LABEL_SUGGESTIONS] }),
    );

    // GET /logement-codes?logement_id=xxx
    fastify.get('/logement-codes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { logement_id } = byLogementSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return reply.notFound('Logement not found');
      if (!(await logementInOrg(fastify.db, logement_id, membership.organization_id))) {
        return reply.notFound('Logement not found');
      }
      if (membership.role !== 'admin') {
        const ok = await canReadCodes(fastify.db, request.user.sub, logement_id);
        if (!ok) return reply.notFound('Logement not found');
      }
      return service.findByLogement(logement_id);
    });

    // POST /logement-codes — admin
    fastify.post('/logement-codes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createLogementCodeSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      if (!(await logementInOrg(fastify.db, data.logement_id, membership.organization_id))) {
        return reply.notFound('Logement not found');
      }
      return reply.code(201).send(await service.createForLogement(data));
    });

    // PATCH /logement-codes/:id — admin
    fastify.patch(
      '/logement-codes/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateLogementCodeSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Code not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        if (!(await logementInOrg(fastify.db, existing.logement_id, membership.organization_id))) {
          return reply.notFound('Code not found');
        }
        const updated = await service.update(id, {
          ...data,
          ...(data.label !== undefined ? { label: data.label.trim() } : {}),
          ...(data.code !== undefined ? { code: data.code.trim() } : {}),
        });
        await service.syncLegacyKeySafeCode(existing.logement_id);
        return updated;
      },
    );

    // DELETE /logement-codes/:id — admin
    fastify.delete(
      '/logement-codes/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Code not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        if (!(await logementInOrg(fastify.db, existing.logement_id, membership.organization_id))) {
          return reply.notFound('Code not found');
        }
        await service.delete(id);
        await service.syncLegacyKeySafeCode(existing.logement_id);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'logement-code-module' },
);
