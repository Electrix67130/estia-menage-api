import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import env from '@/config/env';

// `/auth/reset-password` est public : gardé par le token de réinitialisation
// (signé + expirable), il est appelé depuis la page web de reset (sans API key).
const PUBLIC_ROUTES = ['/health', '/privacy', '/support', '/auth/reset-password'];
const PUBLIC_PREFIXES = [
  '/files/',
  '/calendar/ical/',
  '/calendar/oauth/',
  '/assets/',
  '/invite/',
  '/reset-password/',
];

async function apiKey(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = request.url.split('?')[0];
    if (PUBLIC_ROUTES.includes(urlPath) || PUBLIC_PREFIXES.some((p) => urlPath.startsWith(p))) return;

    const query = request.query as Record<string, string>;
    const key = request.headers['x-api-key'] || query.api_key;

    if (!key || key !== env.API_KEY) {
      return reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Invalid or missing API key',
      });
    }
  });
}

export default fp(apiKey, { name: 'api-key' });
