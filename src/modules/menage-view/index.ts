import fp from 'fastify-plugin';
import MenageViewService from './menage-view.service';
import {
  markTabViewedSchema,
  markItemViewedSchema,
  unreadQuerySchema,
} from './menage-view.schema';
import { getActiveMembership } from '@/lib/active-membership';

/**
 * Suivi des consultations → badges « non-lus » du dashboard.
 *
 * - GET  /menage-views/unread-summary  : totaux par ménage + par organisation
 * - GET  /menage-views/unread          : compteurs détaillés d'un ménage
 * - POST /menage-views                 : marque un onglet comme lu (upsert)
 * - POST /menage-views/item            : marque un item (étape/urgence) comme lu
 *
 * Note : `documents`, `emergencies`, `emergencies_claim` renvoient toujours 0
 * (entités absentes côté API). `POST /menage-views/item` est accepté mais
 * sans effet tant que ces entités n'existent pas — le marquage par onglet
 * (`POST /menage-views`) suffit à effacer les non-lus des onglets réels.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new MenageViewService(fastify.db);

    // GET /menage-views/unread-summary
    fastify.get(
      '/menage-views/unread-summary',
      { preHandler: [fastify.authenticate] },
      async (request) => {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return { by_menage: {}, by_organization: {} };
        return service.getUnreadSummary(
          request.user.sub,
          membership.organization_id,
          membership.role === 'admin',
        );
      },
    );

    // GET /menage-views/unread?menage_id=...
    fastify.get(
      '/menage-views/unread',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { menage_id } = unreadQuerySchema.parse(request.query);
        const menage = await fastify.db('menage').where({ id: menage_id }).first();
        if (!menage) return reply.notFound('Menage not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        return service.getUnreadForMenage(request.user.sub, menage_id);
      },
    );

    // POST /menage-views — marque un onglet comme lu
    fastify.post(
      '/menage-views',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { menage_id, tab } = markTabViewedSchema.parse(request.body);
        const menage = await fastify.db('menage').where({ id: menage_id }).first();
        if (!menage) return reply.notFound('Menage not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        await service.markTabViewed(request.user.sub, menage_id, tab);
        return reply.code(204).send();
      },
    );

    // POST /menage-views/item — marque un item (étape/urgence) comme lu.
    // No-op pour l'instant : pas d'entité par item côté API (voir en-tête).
    fastify.post(
      '/menage-views/item',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        markItemViewedSchema.parse(request.body);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'menage-view-module' },
);
