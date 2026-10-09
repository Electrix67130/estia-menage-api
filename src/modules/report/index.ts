import fp from 'fastify-plugin';
import { z } from 'zod';
import ReportService from './report.service';
import { createReportSchema, listReportsSchema, resolveReportSchema } from './report.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { requireSuperAdmin } from '@/lib/super-admin';

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new ReportService(fastify.db);
    const support = [fastify.authenticate, requireSuperAdmin(fastify)];

    // POST /reports — signaler un message, une photo ou un membre
    fastify.post(
      '/reports',
      { preHandler: [fastify.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const data = createReportSchema.parse(request.body);
        const result = await service.submit(data, request.user.sub, (err) =>
          fastify.log.error({ err }, 'Report notify failed'),
        );
        // 404 et non 403 : dire « interdit » confirmerait que la cible existe.
        if (result.kind === 'not_found') return reply.notFound('Cible introuvable');
        if (result.kind === 'self') {
          return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'On ne se signale pas soi-même' });
        }
        return reply.code(result.kind === 'created' ? 201 : 200).send(result.report);
      },
    );

    // GET /reports — les signalements de son organisation (administrateurs)
    fastify.get('/reports', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const filters = listReportsSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Réservé aux administrateurs' });
      }
      return service.listForOrganization(membership.organization_id, request.user.sub, filters);
    });

    // PATCH /reports/:id — traiter ou rejeter (admin de l'organisation, ou console)
    fastify.patch('/reports/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = resolveReportSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Signalement introuvable');

      if (!(await service.isSuperAdmin(request.user.sub))) {
        const role = await service.roleIn(request.user.sub, existing.organization_id);
        // La personne visée ne traite pas le signalement qui la concerne.
        if (role !== 'admin' || existing.target_user_id === request.user.sub) {
          return reply.notFound('Signalement introuvable');
        }
      }
      return service.resolve(id, data, request.user.sub);
    });

    // GET /super-admin/reports — tous les signalements, pour la console
    fastify.get('/super-admin/reports', { preHandler: support }, async (request) => {
      const filters = listReportsSchema
        .extend({ escalated: z.enum(['1', 'true']).optional(), organization_id: z.string().uuid().optional() })
        .parse(request.query);
      return service.listAll({ ...filters, escalated: !!filters.escalated });
    });

    done();
  },
  { name: 'report-module' },
);
