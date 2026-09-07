import fp from 'fastify-plugin';
import { Knex } from 'knex';
import { z } from 'zod';
import LogementOptionService from './logement-option.service';
import {
  OPTION_SUGGESTIONS,
  createLogementOptionSchema,
  setMenageOptionsSchema,
  updateLogementOptionSchema,
} from './logement-option.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { requireMenageAccess } from '@/lib/permissions';

const byLogementSchema = z.object({ logement_id: z.string().uuid() });
const uuidSchema = z.object({ id: z.string().uuid() });

async function logementInOrg(db: Knex, logementId: string, orgId: string): Promise<boolean> {
  const row = await db('logement').where({ id: logementId, organization_id: orgId }).first();
  return Boolean(row);
}

/**
 * Options d'un logement (pack romantique, pack anniversaire…) et options
 * retenues par le client sur une prestation.
 *
 * **Écriture admin uniquement**, y compris le choix par prestation : le
 * prestataire est en lecture seule — il consulte ce qu'il doit installer, il ne
 * coche rien.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new LogementOptionService(fastify.db);

    const requireAdmin = async (
      request: { user: { sub: string } },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        return null;
      }
      return membership;
    };

    // GET /logement-options/suggestions — packs proposés (dashboard + mobile)
    fastify.get(
      '/logement-options/suggestions',
      { preHandler: [fastify.authenticate] },
      async () => ({ labels: [...OPTION_SUGGESTIONS] }),
    );

    // GET /logement-options?logement_id=xxx
    fastify.get('/logement-options', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { logement_id } = byLogementSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return reply.notFound('Logement not found');
      if (!(await logementInOrg(fastify.db, logement_id, membership.organization_id))) {
        return reply.notFound('Logement not found');
      }
      return service.findByLogement(logement_id);
    });

    // POST /logement-options — admin
    fastify.post('/logement-options', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createLogementOptionSchema.parse(request.body);
      const membership = await requireAdmin(request, reply);
      if (!membership) return;
      if (!(await logementInOrg(fastify.db, data.logement_id, membership.organization_id))) {
        return reply.notFound('Logement not found');
      }
      return reply.code(201).send(await service.createForLogement(data));
    });

    // PATCH /logement-options/:id — admin
    fastify.patch('/logement-options/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateLogementOptionSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Option not found');
      const membership = await requireAdmin(request, reply);
      if (!membership) return;
      if (!(await logementInOrg(fastify.db, existing.logement_id, membership.organization_id))) {
        return reply.notFound('Option not found');
      }
      return service.update(id, {
        ...data,
        ...(data.label !== undefined ? { label: data.label.trim() } : {}),
      });
    });

    // DELETE /logement-options/:id — admin
    fastify.delete('/logement-options/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Option not found');
      const membership = await requireAdmin(request, reply);
      if (!membership) return;
      if (!(await logementInOrg(fastify.db, existing.logement_id, membership.organization_id))) {
        return reply.notFound('Option not found');
      }
      await service.delete(id);
      return reply.code(204).send();
    });

    // GET /menages/:id/options — lecture pour tous ceux qui ont accès à la prestation
    fastify.get('/menages/:id/options', { preHandler: [fastify.authenticate] }, async (request) => {
      const { id } = uuidSchema.parse(request.params);
      await requireMenageAccess(fastify.db, request.user.sub, id, 'view_checklist');
      return service.findByMenage(id);
    });

    // PUT /menages/:id/options — admin : coche les options retenues par le client
    fastify.put('/menages/:id/options', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = setMenageOptionsSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      const menage = await fastify.db('menage').where({ id }).first();
      if (!membership || !menage || menage.organization_id !== membership.organization_id) {
        return reply.notFound('Menage not found');
      }
      if (membership.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      // Les options doivent appartenir au logement de la prestation.
      if (data.items.length > 0) {
        const ids = data.items.map((i) => i.logement_option_id);
        const valid = (await fastify.db('logement_option')
          .whereIn('id', ids)
          .andWhere({ logement_id: menage.logement_id })
          .select('id')) as { id: string }[];
        if (valid.length !== new Set(ids).size) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: "Une option n'appartient pas au logement de cette prestation",
          });
        }
      }
      return service.setForMenage(id, data);
    });

    done();
  },
  { name: 'logement-option-module' },
);
