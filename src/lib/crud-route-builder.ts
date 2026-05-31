import { z, ZodType } from 'zod';
import { FastifyInstance, FastifyPluginCallback } from 'fastify';
import BaseService from './base-service';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

interface CrudRouteBuilderOptions<TCreate, TUpdate> {
  prefix: string;
  service: (fastify: FastifyInstance) => BaseService;
  schemas: { create: ZodType<TCreate>; update: ZodType<TUpdate> };
  entityName: string;
}

class CrudRouteBuilder<TCreate, TUpdate> {
  private prefix: string;
  private serviceFactory: (fastify: FastifyInstance) => BaseService;
  private schemas: { create: ZodType<TCreate>; update: ZodType<TUpdate> };
  private entityName: string;

  constructor({ prefix, service, schemas, entityName }: CrudRouteBuilderOptions<TCreate, TUpdate>) {
    this.prefix = prefix;
    this.serviceFactory = service;
    this.schemas = schemas;
    this.entityName = entityName;
  }

  register: FastifyPluginCallback = (fastify, _opts, done) => {
    const service = this.serviceFactory(fastify);
    const entityName = this.entityName;

    // GET / — list all (paginated)
    fastify.get(this.prefix, async (request) => {
      const query = paginationSchema.parse(request.query);
      return service.findAll(query);
    });

    // GET /:id — get one
    fastify.get(`${this.prefix}/:id`, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const item = await service.findById(id);
      if (!item) return reply.notFound(`${entityName} not found`);
      return item;
    });

    // POST / — create
    fastify.post(this.prefix, async (request, reply) => {
      const data = this.schemas.create.parse(request.body);
      const item = await service.create(data as Record<string, unknown>);
      return reply.code(201).send(item);
    });

    // PATCH /:id — update
    fastify.patch(`${this.prefix}/:id`, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const data = this.schemas.update.parse(request.body);
      const item = await service.update(id, data as Record<string, unknown>);
      if (!item) return reply.notFound(`${entityName} not found`);
      return item;
    });

    // DELETE /:id — delete
    fastify.delete(`${this.prefix}/:id`, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const deleted = await service.delete(id);
      if (!deleted) return reply.notFound(`${entityName} not found`);
      return reply.code(204).send();
    });

    done();
  };
}

export default CrudRouteBuilder;
