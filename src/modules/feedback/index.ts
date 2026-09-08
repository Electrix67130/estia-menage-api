import fp from 'fastify-plugin';
import { z } from 'zod';
import FeedbackService from './feedback.service';
import {
  createFeedbackSchema,
  listFeedbackSchema,
  respondFeedbackSchema,
} from './feedback.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { notifyFeedbackReply } from '@/lib/push';

const uuidParamSchema = z.object({ id: z.string().uuid() });
const minePaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Signalements : bugs et suggestions envoyés par les utilisateurs.
 *
 * Deux publics dans un seul module. Tout utilisateur connecté dépose un
 * signalement et relit les siens ; les **admins de son organisation** voient
 * ceux de leurs membres et y répondent.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new FeedbackService(fastify.db);

    // POST /feedbacks — déposer un signalement
    fastify.post('/feedbacks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createFeedbackSchema.parse(request.body);
      // L'organisation situe le signalement, sans le conditionner : quelqu'un
      // sans org active doit pouvoir signaler un bug — c'est même probablement
      // de cela qu'il veut parler.
      const membership = await getActiveMembership(fastify.db, request.user.sub);

      const [feedback] = await fastify
        .db('feedback')
        .insert({
          user_id: request.user.sub,
          organization_id: membership?.organization_id ?? null,
          type: data.type,
          subject: data.subject,
          message: data.message,
          platform: data.platform ?? null,
          app_version: data.app_version ?? null,
          screen: data.screen ?? null,
          locale: data.locale ?? 'fr',
        })
        .returning('*');

      return reply.code(201).send(feedback);
    });

    // GET /feedbacks/mine — ses propres signalements et les réponses reçues
    fastify.get('/feedbacks/mine', { preHandler: [fastify.authenticate] }, async (request) => {
      const pagination = minePaginationSchema.parse(request.query);
      return service.findByUser(request.user.sub, pagination);
    });

    // GET /feedbacks/mine/:id — le détail d'un de ses signalements
    fastify.get(
      '/feedbacks/mine/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidParamSchema.parse(request.params);
        const feedback = await service.findById(id);
        // Le signalement d'autrui est traité comme inexistant : un 403
        // confirmerait qu'il existe.
        if (!feedback || feedback.user_id !== request.user.sub) {
          return reply.notFound('Signalement introuvable');
        }
        return feedback;
      },
    );

    // ---------- Console admin (organisation) ----------

    // GET /feedbacks — tous les signalements de l'org, filtrables (admin)
    fastify.get('/feedbacks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const filters = listFeedbackSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const [result, counts] = await Promise.all([
        service.findForOrg(membership.organization_id, filters),
        service.countByStatus(membership.organization_id),
      ]);
      return { ...result, counts };
    });

    // PATCH /feedbacks/:id — changer le statut, écrire une réponse (admin)
    fastify.patch('/feedbacks/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const data = respondFeedbackSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }

      const existing = await service.findById(id);
      if (!existing || existing.organization_id !== membership.organization_id) {
        return reply.notFound('Signalement introuvable');
      }

      const feedback = await service.respond(id, data, request.user.sub);

      // Notifier l'auteur uniquement sur une réponse NOUVELLE : un simple
      // changement de statut ne vaut pas d'interrompre quelqu'un, et
      // ré-enregistrer le même texte ne doit pas re-notifier.
      const newResponse =
        typeof data.response === 'string' && data.response !== (existing.response ?? null);
      if (newResponse && existing.user_id !== request.user.sub) {
        // Détaché de la réponse HTTP : un échec d'envoi ne doit pas annuler une
        // réponse déjà enregistrée.
        notifyFeedbackReply(fastify.db, existing.user_id, id, existing.subject).catch((err) =>
          fastify.log.error({ err, feedback_id: id }, 'push feedback reply failed'),
        );
      }

      return feedback;
    });

    done();
  },
  { name: 'feedback-module' },
);
