import fp from 'fastify-plugin';
import { z } from 'zod';
import CommentService from './comment.service';
import { createCommentSchema, updateCommentSchema } from './comment.schema';
import { requireMenageAccess, requirePermissionForMenage } from '@/lib/permissions';
import { emitToMenage, getMenageRecipientIds } from '@/lib/realtime-hub';
import { sendPushToUsers } from '@/lib/push';
import type { Knex } from 'knex';

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
const mentionableSchema = z.object({ menage_id: z.string().uuid() });

const MENTION_EXCERPT_MAX = 140;

async function authorName(db: Knex, userId: string): Promise<string> {
  const author = await db('user').where({ id: userId }).select('first_name', 'last_name').first();
  return author ? `${author.first_name} ${author.last_name}`.trim() : 'Quelqu’un';
}

/** « X t'a mentionné » avec le début du message : une mention appelle une réponse. */
async function notifyMentioned(
  db: Knex,
  userIds: string[],
  menageId: string,
  authorId: string,
  content: string,
): Promise<void> {
  if (userIds.length === 0) return;
  const name = await authorName(db, authorId);
  const excerpt = content.length > MENTION_EXCERPT_MAX ? `${content.slice(0, MENTION_EXCERPT_MAX - 1)}…` : content;
  await sendPushToUsers(db, userIds, {
    title: `${name} t’a mentionné`,
    body: excerpt,
    data: { menage_id: menageId, type: 'comment_mention' },
  });
}

export default fp(
  (fastify, _opts, done) => {
    const service = new CommentService(fastify.db);

    // GET /comments?menage_id=xxx[&section_id=...] — requires view_comments
    fastify.get('/comments', { preHandler: [fastify.authenticate] }, async (request) => {
      const { menage_id, section_id, ...pagination } = byMenageSchema.parse(request.query);
      await requireMenageAccess(fastify.db, request.user.sub, menage_id, 'view_comments');
      return service.findByMenage(menage_id, { ...pagination, sectionId: section_id });
    });

    // GET /comments/mentionable?menage_id=xxx — personnes qu'on peut mentionner (« @ »)
    fastify.get('/comments/mentionable', { preHandler: [fastify.authenticate] }, async (request) => {
      const { menage_id } = mentionableSchema.parse(request.query);
      await requireMenageAccess(fastify.db, request.user.sub, menage_id, 'view_comments');
      return service.findMentionable(menage_id, request.user.sub);
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

      const { mentioned_user_ids = [], ...fields } = data;
      const comment = await service.create({ ...fields, author_id: request.user.sub });
      const mentioned =
        mentioned_user_ids.length > 0
          ? await service.setMentions(comment.id, data.menage_id, request.user.sub, mentioned_user_ids)
          : [];
      emitToMenage(fastify.db, data.menage_id, {
        type: 'comment.created',
        menage_id: data.menage_id,
        resource_id: comment.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));

      // Notification push aux participants du menage (hors auteur). Les personnes
      // mentionnées reçoivent la notification de mention à la place (pas les deux).
      (async () => {
        await notifyMentioned(fastify.db, mentioned, data.menage_id, request.user.sub, data.content);
        const mentionedSet = new Set(mentioned);
        const recipients = (await getMenageRecipientIds(fastify.db, data.menage_id, request.user.sub)).filter(
          (id) => !mentionedSet.has(id),
        );
        if (recipients.length === 0) return;
        const name = await authorName(fastify.db, request.user.sub);
        await sendPushToUsers(fastify.db, recipients, {
          title: 'Nouveau commentaire',
          body: `${name} a commenté un ménage.`,
          data: { menage_id: data.menage_id, type: 'comment' },
        });
      })().catch((err) => fastify.log.error({ err }, 'push comment failed'));

      return reply.code(201).send({ ...comment, mentions: await service.mentionsOf(comment.id) });
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
      const { mentioned_user_ids, ...fields } = data;
      const comment = await service.update(id, fields);
      if (mentioned_user_ids) {
        // Seules les personnes ajoutées à l'édition sont notifiées.
        const added = await service.setMentions(id, existing.menage_id, request.user.sub, mentioned_user_ids);
        notifyMentioned(fastify.db, added, existing.menage_id, request.user.sub, comment?.content ?? existing.content).catch(
          (err) => fastify.log.error({ err }, 'push mention failed'),
        );
      }
      emitToMenage(fastify.db, existing.menage_id, {
        type: 'comment.updated',
        menage_id: existing.menage_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return { ...comment, mentions: await service.mentionsOf(id) };
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
