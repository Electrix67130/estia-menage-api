import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  LogementCheckTemplateSectionService,
  LogementCheckTemplateItemService,
  findTemplateTree,
} from './logement-check-template.service';
import {
  createTemplateSectionSchema,
  updateTemplateSectionSchema,
  reorderTemplateSectionsSchema,
  createTemplateItemSchema,
  updateTemplateItemSchema,
  reorderTemplateItemsSchema,
} from './logement-check-template.schema';
import { getActiveMembership } from '@/lib/active-membership';

const uuidSchema = z.object({ id: z.string().uuid() });
const byLogementSchema = z.object({ logement_id: z.string().uuid() });

async function assertLogementBelongsToOrg(
  db: import('knex').Knex,
  logementId: string,
  orgId: string,
): Promise<boolean> {
  const row = await db('logement').where({ id: logementId, organization_id: orgId }).first();
  return Boolean(row);
}

async function getSectionLogementId(
  db: import('knex').Knex,
  sectionId: string,
): Promise<string | undefined> {
  const row = await db('logement_check_template_section').where({ id: sectionId }).first();
  return row?.logement_id as string | undefined;
}

export default fp(
  (fastify, _opts, done) => {
    const sectionService = new LogementCheckTemplateSectionService(fastify.db);
    const itemService = new LogementCheckTemplateItemService(fastify.db);

    // GET /logement-check-templates?logement_id=xxx — tree complet
    fastify.get(
      '/logement-check-templates',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = byLogementSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        const ok = await assertLogementBelongsToOrg(fastify.db, logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Logement not found');
        return findTemplateTree(fastify.db, logement_id);
      },
    );

    // POST /logement-check-template-sections — admin
    fastify.post(
      '/logement-check-template-sections',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createTemplateSectionSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(fastify.db, data.logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Logement not found');
        const row = await sectionService.create(data);
        return reply.code(201).send(row);
      },
    );

    // PATCH /logement-check-template-sections/:id
    fastify.patch(
      '/logement-check-template-sections/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateTemplateSectionSchema.parse(request.body);
        const existing = await sectionService.findById(id);
        if (!existing) return reply.notFound('Section not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Section not found');
        return sectionService.update(id, data);
      },
    );

    // DELETE /logement-check-template-sections/:id
    fastify.delete(
      '/logement-check-template-sections/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await sectionService.findById(id);
        if (!existing) return reply.notFound('Section not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(fastify.db, existing.logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Section not found');
        await sectionService.delete(id);
        return reply.code(204).send();
      },
    );

    // POST /logement-check-template-sections/:id/reorder — items
    fastify.post(
      '/logement-check-templates/:logement_id/reorder-sections',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logement_id } = z.object({ logement_id: z.string().uuid() }).parse(request.params);
        const { ordered_ids } = reorderTemplateSectionsSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const ok = await assertLogementBelongsToOrg(fastify.db, logement_id, membership.organization_id);
        if (!ok) return reply.notFound('Logement not found');
        await sectionService.reorder(logement_id, ordered_ids);
        return reply.code(204).send();
      },
    );

    // POST /logement-check-template-items — admin
    fastify.post(
      '/logement-check-template-items',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createTemplateItemSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const logementId = await getSectionLogementId(fastify.db, data.section_id);
        if (!logementId) return reply.notFound('Section not found');
        const ok = await assertLogementBelongsToOrg(fastify.db, logementId, membership.organization_id);
        if (!ok) return reply.notFound('Section not found');
        const row = await itemService.create(data);
        return reply.code(201).send(row);
      },
    );

    // PATCH /logement-check-template-items/:id
    fastify.patch(
      '/logement-check-template-items/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateTemplateItemSchema.parse(request.body);
        const existing = await itemService.findById(id);
        if (!existing) return reply.notFound('Item not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const logementId = await getSectionLogementId(fastify.db, existing.section_id);
        if (!logementId) return reply.notFound('Item not found');
        const ok = await assertLogementBelongsToOrg(fastify.db, logementId, membership.organization_id);
        if (!ok) return reply.notFound('Item not found');
        return itemService.update(id, data);
      },
    );

    // DELETE /logement-check-template-items/:id
    fastify.delete(
      '/logement-check-template-items/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await itemService.findById(id);
        if (!existing) return reply.notFound('Item not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const logementId = await getSectionLogementId(fastify.db, existing.section_id);
        if (!logementId) return reply.notFound('Item not found');
        const ok = await assertLogementBelongsToOrg(fastify.db, logementId, membership.organization_id);
        if (!ok) return reply.notFound('Item not found');
        await itemService.delete(id);
        return reply.code(204).send();
      },
    );

    // POST /logement-check-template-sections/:id/reorder-items
    fastify.post(
      '/logement-check-template-sections/:section_id/reorder-items',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { section_id } = z.object({ section_id: z.string().uuid() }).parse(request.params);
        const { ordered_ids } = reorderTemplateItemsSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const logementId = await getSectionLogementId(fastify.db, section_id);
        if (!logementId) return reply.notFound('Section not found');
        const ok = await assertLogementBelongsToOrg(fastify.db, logementId, membership.organization_id);
        if (!ok) return reply.notFound('Section not found');
        await itemService.reorder(section_id, ordered_ids);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'logement-check-template-module' },
);
