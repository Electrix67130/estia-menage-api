import fastify, { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import autoload from '@fastify/autoload';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import database from './plugins/database';
import errorHandler from './plugins/error-handler';
import apiKey from './plugins/api-key';
import jwtPlugin from './plugins/jwt';
import uploadPlugin from './plugins/upload';
import websocketPlugin from './plugins/websocket';
import {
  renderInvitePage,
  renderResetPasswordPage,
  renderPrivacyPage,
  renderSupportPage,
} from './lib/web-pages';

interface AppOptions extends FastifyServerOptions {
  logLevel?: string;
}

function buildApp(opts: AppOptions = {}) {
  const { logLevel, ...fastifyOpts } = opts;
  const app = fastify({
    logger: {
      level: logLevel || 'info',
    },
    // Les tokens (reset password, invitation) passés en paramètre d'URL font
    // ~200 caractères ; la limite Fastify par défaut (100) les fait 404.
    maxParamLength: 500,
    ...fastifyOpts,
  });

  // Tolère un body vide sur les requêtes `application/json` : certains clients
  // posent toujours ce Content-Type, même sur un DELETE/POST sans corps, ce qui
  // déclenche sinon l'erreur Fastify « Body cannot be empty when content-type
  // is set to 'application/json' ».
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const str = typeof body === 'string' ? body : '';
      if (str.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  // Security plugins
  // CORP par défaut de helmet = 'same-origin' → bloque le chargement des fichiers
  // de l'API (avatars, photos logement, logo email) dans le dashboard web
  // (origine différente). On autorise le cross-origin pour les ressources servies.
  app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.register(sensible);

  // File handling
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'uploads'), prefix: '/uploads/', decorateReply: true });
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'assets'), prefix: '/assets/', decorateReply: false });

  // Infrastructure plugins
  app.register(database);
  app.register(errorHandler);
  app.register(apiKey);
  app.register(jwtPlugin);
  app.register(uploadPlugin);
  app.register(websocketPlugin);

  // Auto-load all modules (each module registers its own routes)
  app.register(autoload, {
    dir: path.join(__dirname, 'modules'),
    encapsulate: false,
    maxDepth: 1,
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Pages web publiques (pont email -> app mobile via deep link)
  app.get('/invite/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    reply.type('text/html').send(renderInvitePage(token));
  });
  app.get('/reset-password/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    reply.type('text/html').send(renderResetPasswordPage(token));
  });

  // Pages legales publiques (referencees dans la fiche App Store)
  app.get('/privacy', async (_request, reply) => {
    reply.type('text/html').send(renderPrivacyPage());
  });
  app.get('/support', async (_request, reply) => {
    reply.type('text/html').send(renderSupportPage());
  });

  return app;
}

export default buildApp;
