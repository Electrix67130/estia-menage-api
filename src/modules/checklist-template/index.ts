import fp from 'fastify-plugin';
import { z } from 'zod';
import ChecklistTemplateService from './checklist-template.service';
import {
  createChecklistTemplateSchema,
  updateChecklistTemplateSchema,
  applyTemplateSchema,
} from './checklist-template.schema';
import { getActiveMembership } from '@/lib/active-membership';

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new ChecklistTemplateService(fastify.db);

    // GET /checklist-templates — liste (avec section_count) de l'org
    fastify.get('/checklist-templates', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
      }
      const data = await service.listByOrg(membership.organization_id);
      return { data };
    });

    // GET /checklist-templates/:id — arbre complet
    fastify.get('/checklist-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
      }
      const tree = await service.findTree(id, membership.organization_id);
      if (!tree) return reply.notFound('Modèle introuvable');
      return tree;
    });

    // POST /checklist-templates — admin only
    fastify.post('/checklist-templates', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createChecklistTemplateSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const id = await service.createWithTree(membership.organization_id, data.name, data.sections);
      const tree = await service.findTree(id, membership.organization_id);
      return reply.code(201).send(tree);
    });

    // PATCH /checklist-templates/:id — admin only (remplace l'arbre si fourni)
    fastify.patch('/checklist-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateChecklistTemplateSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const existing = await service.findTree(id, membership.organization_id);
      if (!existing) return reply.notFound('Modèle introuvable');
      await service.updateWithTree(id, data);
      return service.findTree(id, membership.organization_id);
    });

    // DELETE /checklist-templates/:id — admin only
    fastify.delete('/checklist-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const ok = await service.delete(id, membership.organization_id);
      if (!ok) return reply.notFound('Modèle introuvable');
      return reply.code(204).send();
    });

    // POST /logements/:id/apply-checklist-template — admin only
    fastify.post(
      '/logements/:id/apply-checklist-template',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { template_id } = applyTemplateSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const logement = await fastify.db('logement')
          .where({ id, organization_id: membership.organization_id })
          .first();
        if (!logement) return reply.notFound('Logement not found');
        const ok = await service.applyToLogement(template_id, membership.organization_id, id);
        if (!ok) return reply.notFound('Modèle introuvable');
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'checklist-template-module' },
);
