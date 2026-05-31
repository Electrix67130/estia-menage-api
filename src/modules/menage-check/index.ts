import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  MenageCheckSectionService,
  MenageCheckItemService,
  findChecklistTree,
} from './menage-check.service';
import {
  createSectionSchema,
  updateSectionSchema,
  reorderSectionsSchema,
  createItemSchema,
  updateItemSchema,
  reorderItemsSchema,
  toggleItemSchema,
} from './menage-check.schema';
import {
  requirePermissionForMenage,
  requirePermissionForLogement,
} from '@/lib/permissions';
import { emitToMenage } from '@/lib/realtime-hub';

const uuidSchema = z.object({ id: z.string().uuid() });
const menageParam = z.object({ menage_id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const sectionService = new MenageCheckSectionService(fastify.db);
    const itemService = new MenageCheckItemService(fastify.db);

    // GET /menages/:menage_id/check
    fastify.get(
      '/menages/:menage_id/check',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { menage_id } = menageParam.parse(request.params);
        const menage = await fastify.db('menage').where({ id: menage_id }).first();
        if (!menage) return reply.notFound('Menage not found');
        // Prestataire assigné OU permission view_checklist sur le logement
        const isPrestataire = menage.prestataire_user_id === request.user.sub;
        if (!isPrestataire) {
          await requirePermissionForLogement(
            fastify.db,
            request.user.sub,
            menage.logement_id,
            'view_checklist',
          );
        }
        return findChecklistTree(fastify.db, menage_id);
      },
    );

    // POST /menage-check-sections — création manuelle d'une section
    fastify.post(
      '/menage-check-sections',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createSectionSchema.parse(request.body);
        await requirePermissionForMenage(fastify.db, request.user.sub, data.menage_id, 'edit');
        const [maxRow] = (await fastify.db('menage_check_section')
          .where({ menage_id: data.menage_id })
          .max('position as max')) as { max: number | null }[];
        const position = data.position ?? (maxRow?.max ?? -1) + 1;
        const section = await sectionService.create({ ...data, position });
        return reply.code(201).send(section);
      },
    );

    // PATCH /menage-check-sections/:id
    fastify.patch(
      '/menage-check-sections/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateSectionSchema.parse(request.body);
        const existing = await sectionService.findById(id);
        if (!existing) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, existing.menage_id, 'edit');
        return sectionService.update(id, data);
      },
    );

    // DELETE /menage-check-sections/:id
    fastify.delete(
      '/menage-check-sections/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await sectionService.findById(id);
        if (!existing) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, existing.menage_id, 'edit');
        await sectionService.delete(id);
        return reply.code(204).send();
      },
    );

    // POST /menages/:menage_id/check/sections/reorder
    fastify.post(
      '/menages/:menage_id/check/sections/reorder',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { menage_id } = menageParam.parse(request.params);
        const { ordered_ids } = reorderSectionsSchema.parse(request.body);
        await requirePermissionForMenage(fastify.db, request.user.sub, menage_id, 'edit');
        await sectionService.reorder(menage_id, ordered_ids);
        return reply.code(204).send();
      },
    );

    // POST /menage-check-items
    fastify.post(
      '/menage-check-items',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createItemSchema.parse(request.body);
        const section = await sectionService.findById(data.section_id);
        if (!section) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, section.menage_id, 'edit');
        const [maxRow] = (await fastify.db('menage_check_item')
          .where({ section_id: data.section_id })
          .max('position as max')) as { max: number | null }[];
        const position = data.position ?? (maxRow?.max ?? -1) + 1;
        const item = await itemService.create({ ...data, position });
        return reply.code(201).send(item);
      },
    );

    // PATCH /menage-check-items/:id
    fastify.patch(
      '/menage-check-items/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateItemSchema.parse(request.body);
        const existing = await itemService.findById(id);
        if (!existing) return reply.notFound('Item not found');
        const section = await sectionService.findById(existing.section_id);
        if (!section) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, section.menage_id, 'edit');
        return itemService.update(id, data);
      },
    );

    // DELETE /menage-check-items/:id
    fastify.delete(
      '/menage-check-items/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await itemService.findById(id);
        if (!existing) return reply.notFound('Item not found');
        const section = await sectionService.findById(existing.section_id);
        if (!section) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, section.menage_id, 'edit');
        await itemService.delete(id);
        return reply.code(204).send();
      },
    );

    // POST /menage-check-sections/:id/items/reorder
    fastify.post(
      '/menage-check-sections/:id/items/reorder',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { ordered_ids } = reorderItemsSchema.parse(request.body);
        const section = await sectionService.findById(id);
        if (!section) return reply.notFound('Section not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, section.menage_id, 'edit');
        await itemService.reorder(id, ordered_ids);
        return reply.code(204).send();
      },
    );

    // POST /menage-check-items/:id/toggle
    fastify.post(
      '/menage-check-items/:id/toggle',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = toggleItemSchema.parse(request.body);
        const existing = await itemService.findById(id);
        if (!existing) return reply.notFound('Item not found');
        const section = await sectionService.findById(existing.section_id);
        if (!section) return reply.notFound('Section not found');
        const menage = await fastify.db('menage').where({ id: section.menage_id }).first();
        if (!menage) return reply.notFound('Menage not found');
        // Prestataire assigné OU edit permission
        const isPrestataire = menage.prestataire_user_id === request.user.sub;
        if (!isPrestataire) {
          await requirePermissionForMenage(fastify.db, request.user.sub, section.menage_id, 'edit');
        }
        const updated = await itemService.toggle(id, data.validated, request.user.sub, data.comment);
        emitToMenage(fastify.db, section.menage_id, {
          type: 'menage-check-item.toggled',
          menage_id: section.menage_id,
          resource_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
        return updated;
      },
    );

    done();
  },
  { name: 'menage-check-module' },
);
