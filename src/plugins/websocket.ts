import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { addConnection, removeConnection } from '@/lib/realtime-hub';

const PING_INTERVAL_MS = 30_000;

declare module 'fastify' {
  interface FastifyInstance {
    realtimeReady: boolean;
  }
}

async function websocketPlugin(fastify: FastifyInstance) {
  await fastify.register(websocket);

  // GET /ws — endpoint websocket. Auth via ?token=<JWT> en query string
  // (les WS clients ne peuvent pas envoyer d'header Authorization simplement).
  fastify.get('/ws', { websocket: true }, async (socket, request) => {
    const token = (request.query as { token?: string }).token;
    if (!token) {
      socket.close(1008, 'Missing token');
      return;
    }

    let userId: string;
    try {
      const decoded = await fastify.jwt.verify<{ sub: string; jti?: string }>(token);
      userId = decoded.sub;
      // Note : on ne fait PAS la verification single-session ici pour eviter
      // d'avoir a la maintenir sur la duree de vie de la connexion. Les events
      // emis sont eux scoped par menage_id donc le risque de fuite d'info
      // est limite — l'utilisateur recoit uniquement ce qu'il pourrait voir
      // via une requete HTTP normale.
    } catch {
      socket.close(1008, 'Invalid token');
      return;
    }

    addConnection(userId, socket);
    fastify.log.info({ userId }, 'WS connected');

    // Ping keepalive — empeche le tunnel cloudflared (idle 100s) et les
    // load balancers de couper la connexion.
    const pingInterval = setInterval(() => {
      try {
        socket.ping();
      } catch {
        // ignore — sera nettoye par le close handler
      }
    }, PING_INTERVAL_MS);

    socket.on('close', () => {
      clearInterval(pingInterval);
      removeConnection(userId, socket);
      fastify.log.info({ userId }, 'WS disconnected');
    });

    socket.on('error', (err: Error) => {
      fastify.log.error({ err, userId }, 'WS error');
    });

    // Le client peut envoyer des messages mais on ignore — c'est unidirectionnel
    // (server -> client). Ca laisse une marge pour ajouter "subscribe to menage"
    // plus tard si on veut affiner les events emis.
    socket.on('message', () => {
      // ignore
    });

    fastify.realtimeReady = true;
  });
}

export default fp(websocketPlugin, { name: 'websocket' });
