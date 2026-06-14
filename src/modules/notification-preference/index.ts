import fp from 'fastify-plugin';
import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@/lib/push';

const updateSchema = z.object({
  key: z.enum(NOTIFICATION_CATEGORIES),
  enabled: z.boolean(),
});

export default fp(
  (fastify, _opts, done) => {
    // GET /notification-preferences — état de chaque catégorie pour le user courant.
    // Par défaut tout est activé ; seules les valeurs explicitement `false` coupent.
    fastify.get(
      '/notification-preferences',
      { preHandler: [fastify.authenticate] },
      async (request) => {
        const row = (await fastify.db('user')
          .where({ id: request.user.sub })
          .select('notification_prefs')
          .first()) as { notification_prefs: Record<string, boolean> | null } | undefined;
        const prefs = row?.notification_prefs ?? {};
        return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, prefs[c] !== false]));
      },
    );

    // PATCH /notification-preferences — active/désactive une catégorie.
    fastify.patch(
      '/notification-preferences',
      { preHandler: [fastify.authenticate] },
      async (request) => {
        const { key, enabled } = updateSchema.parse(request.body);
        await fastify.db('user')
          .where({ id: request.user.sub })
          .update({
            notification_prefs: fastify.db.raw(
              `jsonb_set(coalesce(notification_prefs, '{}'::jsonb), ?, ?::jsonb, true)`,
              [`{${key}}`, JSON.stringify(enabled)],
            ),
          });
        return { key, enabled };
      },
    );

    done();
  },
  { name: 'notification-preference-module' },
);
