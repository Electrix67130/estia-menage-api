import fp from 'fastify-plugin';
import NotificationPreferenceService from './notification-preference.service';
import { logementLevelSchema, logementParamsSchema, updatePreferenceSchema } from './notification-preference.schema';

export default fp(
  (fastify, _opts, done) => {
    const service = new NotificationPreferenceService(fastify.db);

    // GET /notification-preferences — catégories (à plat), interrupteur général, logements réglés.
    // Par défaut tout est activé ; seules les valeurs explicitement `false` coupent.
    fastify.get('/notification-preferences', { preHandler: [fastify.authenticate] }, async (request) => {
      return service.get(request.user.sub);
    });

    // PATCH /notification-preferences — `{ key, enabled }` (une catégorie) ou `{ push_enabled }` (tout).
    fastify.patch('/notification-preferences', { preHandler: [fastify.authenticate] }, async (request) => {
      const data = updatePreferenceSchema.parse(request.body);
      await service.update(request.user.sub, data);
      return data;
    });

    // GET /notification-preferences/logements/:logementId — réglage d'un logement
    fastify.get(
      '/notification-preferences/logements/:logementId',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logementId } = logementParamsSchema.parse(request.params);
        if (!(await service.canAccessLogement(request.user.sub, logementId))) {
          return reply.notFound('Logement not found');
        }
        return { logement_id: logementId, level: await service.getLogementLevel(request.user.sub, logementId) };
      },
    );

    // PUT /notification-preferences/logements/:logementId — tout, l'important, ou rien
    fastify.put(
      '/notification-preferences/logements/:logementId',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { logementId } = logementParamsSchema.parse(request.params);
        const { level } = logementLevelSchema.parse(request.body);
        if (!(await service.canAccessLogement(request.user.sub, logementId))) {
          return reply.notFound('Logement not found');
        }
        await service.setLogementLevel(request.user.sub, logementId, level);
        return { logement_id: logementId, level };
      },
    );

    done();
  },
  { name: 'notification-preference-module' },
);
