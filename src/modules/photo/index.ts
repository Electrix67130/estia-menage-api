import fp from 'fastify-plugin';
import { z } from 'zod';
import PhotoService from './photo.service';
import { createPhotoSchema } from './photo.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { emitToMenage } from '@/lib/realtime-hub';
import { requirePermissionForMenage } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';

const listPhotosSchema = z
  .object({
    menage_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
    logement_id: z.string().uuid().optional(),
    logement_room_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(20),
  })
  .refine((q) => Boolean(q.menage_id) || Boolean(q.logement_id) || Boolean(q.logement_room_id), {
    message: 'menage_id ou logement_id requis',
  });

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new PhotoService(fastify.db);

    // GET /photos — par menage OU par logement (avec filtre éventuel pièce)
    fastify.get('/photos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { menage_id, section_id, logement_id, logement_room_id, page, limit } =
        listPhotosSchema.parse(request.query);
      if (menage_id) {
        await requirePermissionForMenage(fastify.db, request.user.sub, menage_id, 'view_photos');
        const result = await service.findByMenage(menage_id, { page, limit, section_id });
        return { ...result, data: signUrlsInList(result.data) };
      }
      // Photos d'un logement : doit être membre ou admin de l'org du logement
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      const targetLogementId = logement_id ?? (await getLogementOfRoom(fastify.db, logement_room_id!));
      if (!membership || !targetLogementId) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Logement non accessible',
        });
      }
      const logement = await fastify.db('logement').where({ id: targetLogementId }).first();
      if (!logement || logement.organization_id !== membership.organization_id) {
        return reply.notFound('Logement not found');
      }
      const result = await service.findByLogement(targetLogementId, { page, limit, logement_room_id });
      return { ...result, data: signUrlsInList(result.data) };
    });

    // GET /photos/:id
    fastify.get('/photos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const photo = await service.findById(id);
      if (!photo) return reply.notFound('Photo not found');
      if (photo.menage_id) {
        await requirePermissionForMenage(fastify.db, request.user.sub, photo.menage_id, 'view_photos');
      } else if (photo.logement_id) {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const logement = await fastify.db('logement').where({ id: photo.logement_id }).first();
        if (!logement || !membership || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Photo not found');
        }
      }
      return photo;
    });

    // POST /photos — requires edit on menage, OR admin for logement-level photos
    fastify.post('/photos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createPhotoSchema.parse(request.body);
      if (data.menage_id) {
        await requirePermissionForMenage(fastify.db, request.user.sub, data.menage_id, 'edit');
        // Si un rattachement à une pièce est fourni, la section doit appartenir à ce ménage
        if (data.section_id) {
          const section = await fastify.db('menage_check_section')
            .where({ id: data.section_id, menage_id: data.menage_id })
            .first();
          if (!section) return reply.notFound('Section not found for this menage');
        }
      } else if (data.logement_id) {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Seul un administrateur peut ajouter une photo au logement',
          });
        }
        const logement = await fastify.db('logement').where({ id: data.logement_id }).first();
        if (!logement || logement.organization_id !== membership.organization_id) {
          return reply.notFound('Logement not found');
        }
        // Si un rattachement à une pièce est fourni, elle doit appartenir à ce logement
        if (data.logement_room_id) {
          const room = await fastify.db('logement_room')
            .where({ id: data.logement_room_id, logement_id: data.logement_id })
            .first();
          if (!room) return reply.notFound('Room not found for this logement');
        }
      }
      const photo = await service.create({ ...data, uploaded_by: request.user.sub });
      if (data.menage_id) {
        emitToMenage(fastify.db, data.menage_id, {
          type: 'photo.created',
          menage_id: data.menage_id,
          resource_id: photo.id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      }
      return reply.code(201).send(photo);
    });

    // DELETE /photos/:id — uploader or edit permission (menage) / admin (logement)
    fastify.delete('/photos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Photo not found');
      if (existing.uploaded_by !== request.user.sub) {
        if (existing.menage_id) {
          await requirePermissionForMenage(fastify.db, request.user.sub, existing.menage_id, 'edit');
        } else if (existing.logement_id) {
          const membership = await getActiveMembership(fastify.db, request.user.sub);
          if (membership?.role !== 'admin') {
            return reply.code(403).send({
              statusCode: 403,
              error: 'Forbidden',
              message: 'Admin only',
            });
          }
        }
      }
      await service.delete(id);
      if (existing.menage_id) {
        emitToMenage(fastify.db, existing.menage_id, {
          type: 'photo.deleted',
          menage_id: existing.menage_id,
          resource_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      }
      return reply.code(204).send();
    });

    done();
  },
  { name: 'photo-module' },
);

async function getLogementOfRoom(
  db: import('knex').Knex,
  roomId: string,
): Promise<string | undefined> {
  const row = await db('logement_room').where({ id: roomId }).first();
  return row?.logement_id as string | undefined;
}
