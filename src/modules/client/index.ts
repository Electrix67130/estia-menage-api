import fp from 'fastify-plugin';
import { z } from 'zod';
import ClientService from './client.service';
import { createClientSchema, updateClientSchema } from './client.schema';
import { getActiveMembership } from '@/lib/active-membership';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional(),
});

const uuidSchema = z.object({ id: z.string().uuid() });

const reportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
});

export default fp(
  (fastify, _opts, done) => {
    const service = new ClientService(fastify.db);

    fastify.get('/clients', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const query = listSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'No active organization',
        });
      }
      return service.findActiveByOrg(membership.organization_id, query);
    });

    fastify.get('/clients/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return reply.notFound('Client not found');
      const client = await service.findById(id);
      if (!client || client.organization_id !== membership.organization_id) {
        return reply.notFound('Client not found');
      }
      return client;
    });

    // GET /clients/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD — rapport compta
    // détaillé (ménages, prix client/presta, options linge). Admin only.
    fastify.get(
      '/clients/:id/report',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { from, to } = reportQuerySchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin only',
          });
        }
        const client = await service.findById(id);
        if (!client || client.organization_id !== membership.organization_id) {
          return reply.notFound('Client not found');
        }
        const menages = await service.getReport(id, from, to);
        return { client, period: { from, to }, menages };
      },
    );

    fastify.get(
      '/clients/:id/logements',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return reply.notFound('Client not found');
        const client = await service.findById(id);
        if (!client || client.organization_id !== membership.organization_id) {
          return reply.notFound('Client not found');
        }
        return service.findLogements(id);
      },
    );

    fastify.post('/clients', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createClientSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Seul un administrateur peut créer un client',
        });
      }
      const row = await service.create({
        ...data,
        created_by: request.user.sub,
        organization_id: membership.organization_id,
      });
      return reply.code(201).send(row);
    });

    fastify.patch(
      '/clients/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = updateClientSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const existing = await service.findById(id);
        if (!existing || existing.organization_id !== membership?.organization_id) {
          return reply.notFound('Client not found');
        }
        if (membership?.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Seul un administrateur peut modifier un client',
          });
        }
        return service.update(id, data);
      },
    );

    fastify.delete(
      '/clients/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const existing = await service.findById(id);
        if (!existing || existing.organization_id !== membership?.organization_id) {
          return reply.notFound('Client not found');
        }
        if (membership?.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin only',
          });
        }
        await service.archive(id);
        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'client-module' },
);
