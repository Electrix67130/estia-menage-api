import fp from 'fastify-plugin';
import { z } from 'zod';
import MenageResponseService from './menage-response.service';
import { upsertMenageResponseSchema, listMyMenagesSchema } from './menage-response.schema';
import { getActiveMembership } from '@/lib/active-membership';

const menageIdParam = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new MenageResponseService(fastify.db);

    // GET /menages/:id/responses — admin ou tout membre du logement parent
    fastify.get(
      '/menages/:id/responses',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = menageIdParam.parse(request.params);
        const menage = await fastify.db('menage').where({ id }).first();
        if (!menage) return reply.notFound('Menage not found');

        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'No access to this menage',
          });
        }
        // Admin OK directement. Sinon il faut être logement_member.
        if (membership.role !== 'admin') {
          const member = await fastify.db('logement_member')
            .where({ logement_id: menage.logement_id, user_id: request.user.sub })
            .first();
          if (!member) {
            return reply
              .code(403)
              .send({ statusCode: 403, error: 'Forbidden', message: 'Not a member of this logement' });
          }
        }

        const data = await service.findByMenage(id);
        return { data };
      },
    );

    // POST /menages/:id/responses — current user vote présent/absent
    // Admin peut passer un `user_id` dans le body pour flipper le vote d'un presta.
    fastify.post(
      '/menages/:id/responses',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = menageIdParam.parse(request.params);
        const { status, user_id: bodyUserId } = upsertMenageResponseSchema.parse(request.body);

        const menage = await fastify.db('menage').where({ id }).first();
        if (!menage) return reply.notFound('Menage not found');
        if (menage.status === 'valide') {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Le ménage est déjà validé, on ne peut plus modifier sa réponse',
          });
        }

        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || membership.organization_id !== menage.organization_id) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'No access to this menage',
          });
        }

        // Cas admin override : status pour un autre user. Verifie qu'il est presta sur le logement.
        if (bodyUserId && bodyUserId !== request.user.sub) {
          if (membership.role !== 'admin') {
            return reply.code(403).send({
              statusCode: 403,
              error: 'Forbidden',
              message: "Seul l'admin peut modifier la réponse d'un autre prestataire",
            });
          }
          const member = await fastify.db('logement_member')
            .where({
              logement_id: menage.logement_id,
              user_id: bodyUserId,
              role: 'prestataire',
            })
            .first();
          if (!member) {
            return reply.code(400).send({
              statusCode: 400,
              error: 'Bad Request',
              message: "L'utilisateur n'est pas prestataire de ce logement",
            });
          }
          const response = await service.upsert(id, bodyUserId, status);
          return response;
        }

        // Cas normal : le current user vote pour lui-même → doit être presta du logement
        const context = await service.getLogementForMember(id, request.user.sub);
        if (!context) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Tu dois être prestataire du logement pour répondre',
          });
        }

        const response = await service.upsert(id, request.user.sub, status);
        return response;
      },
    );

    // GET /prestataires/me/menages — liste des prochains ménages du current user
    fastify.get(
      '/prestataires/me/menages',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const query = listMyMenagesSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        const data = await service.findMyUpcomingMenages(
          request.user.sub,
          membership.organization_id,
          query,
        );
        return { data };
      },
    );

    done();
  },
  { name: 'menage-response-module' },
);
