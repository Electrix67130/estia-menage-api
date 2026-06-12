import fp from 'fastify-plugin';
import DeviceTokenService from './device-token.service';
import { registerDeviceTokenSchema, removeDeviceTokenSchema } from './device-token.schema';

export default fp(
  (fastify, _opts, done) => {
    const service = new DeviceTokenService(fastify.db);

    // POST /device-tokens — enregistre/rafraichit le token push de l'appareil courant
    fastify.post('/device-tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = registerDeviceTokenSchema.parse(request.body);
      const row = await service.register(request.user.sub, data.token, data.platform);
      return reply.code(201).send(row);
    });

    // DELETE /device-tokens — desenregistre l'appareil (au logout). Token dans le body
    // car un ExponentPushToken contient des caracteres non URL-safe.
    fastify.delete('/device-tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { token } = removeDeviceTokenSchema.parse(request.body);
      await service.removeByToken(request.user.sub, token);
      return reply.code(204).send();
    });

    done();
  },
  { name: 'device-token-module' },
);
