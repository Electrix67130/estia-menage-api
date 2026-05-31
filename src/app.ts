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

interface AppOptions extends FastifyServerOptions {
  logLevel?: string;
}

function buildApp(opts: AppOptions = {}) {
  const { logLevel, ...fastifyOpts } = opts;
  const app = fastify({
    logger: {
      level: logLevel || 'info',
    },
    ...fastifyOpts,
  });

  // Security plugins
  app.register(helmet);
  app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.register(sensible);

  // File handling
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max
  app.register(fastifyStatic, { root: path.join(__dirname, '..', 'uploads'), prefix: '/uploads/', decorateReply: true });

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

  return app;
}

export default buildApp;
