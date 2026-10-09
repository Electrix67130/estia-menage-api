import fp from 'fastify-plugin';
import UserBlockService from './user-block.service';
import { blockUserSchema, blockedUserParamSchema } from './user-block.schema';

export default fp(
  (fastify, _opts, done) => {
    const service = new UserBlockService(fastify.db);

    // GET /blocks — les personnes que j'ai bloquées
    fastify.get('/blocks', { preHandler: [fastify.authenticate] }, async (request) => {
      return { data: await service.list(request.user.sub) };
    });

    // POST /blocks — bloquer quelqu'un avec qui je partage une organisation
    fastify.post('/blocks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { user_id } = blockUserSchema.parse(request.body);
      if (user_id === request.user.sub) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'On ne se bloque pas soi-même' });
      }
      // Pas d'organisation en commun : 404, on ne confirme pas l'existence d'un
      // compte qu'on n'a aucune raison de connaître.
      if (!(await service.sharesOrganization(request.user.sub, user_id))) {
        return reply.notFound('Utilisateur introuvable');
      }
      await service.block(request.user.sub, user_id);
      return reply.code(201).send({ user_id });
    });

    // DELETE /blocks/:userId — débloquer
    fastify.delete('/blocks/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { userId } = blockedUserParamSchema.parse(request.params);
      await service.unblock(request.user.sub, userId);
      return reply.code(204).send();
    });

    done();
  },
  { name: 'user-block-module' },
);
