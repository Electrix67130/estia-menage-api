import fp from 'fastify-plugin';
import { z } from 'zod';
import CommentService from './comment.service';
import { createCommentSchema, updateCommentSchema } from './comment.schema';
import { requireMenageAccess, requirePermissionForMenage } from '@/lib/permissions';
import { emitToMenage, getMenageRecipientIds } from '@/lib/realtime-hub';
import { sendPushToUsers } from '@/lib/push';

const byMenageSchema = z.object({
  menage_id: z.string().uuid(),
  // section_id filter : 'general' = uniquement les messages hors-section (section_id IS NULL),
  // un uuid = uniquement les messages de cette section, omis = tous les messages.
  section_id: z.union([z.string().uuid(), z.literal('general')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new CommentService(fastify.db);

    // GET /comments?menage_id=xxx[&section_id=...] — requires view_comments
    fastify.get('/comments', { preHandler: [fastify.authenticate] }, async (request) => {
      const { menage_id, section_id, ...pagination } = byMenageSchema.parse(request.query);
      await requireMenageAccess(fastify.db, request.user.sub, menage_id, 'view_comments');
      return service.findByMenage(menage_id, { ...pagination, sectionId: section_id });
    });

    fastify.get('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const comment = await service.findById(id);
      if (!comment) return reply.notFound('Comment not found');
      await requireMenageAccess(
        fastify.db,
        request.user.sub,
        comment.menage_id,
        'view_comments',
      );
      return comment;
    });

    fastify.post('/comments', { preHandler: [fastify.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      const data = createCommentSchema.parse(request.body);
      await requireMenageAccess(fastify.db, request.user.sub, data.menage_id, 'view_comments');

      // Si section_id fourni, verifier qu'elle appartient bien au meme menage
      if (data.section_id) {
        const section = await fastify.db('menage_check_section')
          .where({ id: data.section_id })
          .select('menage_id')
          .first();
        if (!section || section.menage_id !== data.menage_id) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'section_id ne correspond pas au ménage',
          });
        }
      }

      const comment = await service.create({ ...data, author_id: request.user.sub });
      emitToMenage(fastify.db, data.menage_id, {
        type: 'comment.created',
        menage_id: data.menage_id,
        resource_id: comment.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));

      // Notification push aux participants du menage (hors auteur).
      (async () => {
        const recipients = await getMenageRecipientIds(fastify.db, data.menage_id, request.user.sub);
        if (recipients.length === 0) return;
        const author = await fastify.db('user')
          .where({ id: request.user.sub })
          .select('first_name', 'last_name')
          .first();
        const name = author ? `${author.first_name} ${author.last_name}`.trim() : 'Quelqu’un';
        await sendPushToUsers(fastify.db, recipients, {
          title: 'Nouveau commentaire',
          body: `${name} a commenté un ménage.`,
          data: { menage_id: data.menage_id, type: 'comment' },
        });
      })().catch((err) => fastify.log.error({ err }, 'push comment failed'));

      return reply.code(201).send(comment);
    });

    fastify.patch('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateCommentSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Comment not found');
      if (existing.author_id !== request.user.sub) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Only the author can edit this comment',
        });
      }
      const comment = await service.update(id, data);
      emitToMenage(fastify.db, existing.menage_id, {
        type: 'comment.updated',
        menage_id: existing.menage_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return comment;
    });

    fastify.delete('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Comment not found');
      if (existing.author_id !== request.user.sub) {
        await requirePermissionForMenage(fastify.db, request.user.sub, existing.menage_id, 'edit');
      }
      await service.delete(id);
      emitToMenage(fastify.db, existing.menage_id, {
        type: 'comment.deleted',
        menage_id: existing.menage_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'comment-module' },
);
