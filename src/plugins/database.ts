import fp from 'fastify-plugin';
import knex, { Knex } from 'knex';
import knexConfig from '@/config/knexfile';

declare module 'fastify' {
  interface FastifyInstance {
    db: Knex;
  }
}

async function database(fastify: import('fastify').FastifyInstance) {
  const db = knex(knexConfig);

  await db.raw('SELECT 1');
  fastify.log.info('Database connected');

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    await db.destroy();
  });
}

export default fp(database, { name: 'database' });
