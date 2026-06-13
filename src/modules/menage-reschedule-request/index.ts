import fp from 'fastify-plugin';
import { z } from 'zod';
import MenageRescheduleRequestService from './menage-reschedule-request.service';
import {
  createRescheduleRequestSchema,
  decideRescheduleRequestSchema,
  listRescheduleRequestsSchema,
} from './menage-reschedule-request.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { sendPushToUsers, notifyRescheduleCancelled } from '@/lib/push';

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new MenageRescheduleRequestService(fastify.db);

    // GET /reschedule-requests — filtrable, admin voit tout l'org, sinon que les siennes
    fastify.get(
      '/reschedule-requests',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const query = listRescheduleRequestsSchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'No active organization' });
        }
        const effective = {
          ...query,
          requested_by:
            membership.role === 'admin' ? query.requested_by : request.user.sub,
        };
        return service.findFiltered(membership.organization_id, effective);
      },
    );

    // GET /reschedule-requests/:id
    fastify.get(
      '/reschedule-requests/:id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const row = await service.findById(id);
        if (!row) return reply.notFound('Request not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) return reply.notFound('Request not found');
        const menage = await fastify.db('menage').where({ id: row.menage_id }).first();
        if (!menage || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Request not found');
        }
        if (membership.role !== 'admin' && row.requested_by !== request.user.sub) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' });
        }
        return row;
      },
    );

    // POST /reschedule-requests — prestataire assigné uniquement
    fastify.post(
      '/reschedule-requests',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const data = createRescheduleRequestSchema.parse(request.body);
        const menage = await fastify.db('menage').where({ id: data.menage_id }).first();
        if (!menage) return reply.notFound('Menage not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        // Autoriser tout presta qui a accès au ménage : référent, multi-affecté,
        // ou simplement membre prestataire du logement (utile pour signaler son
        // indisponibilité avant même d'être affecté).
        if (membership.role !== 'admin') {
          const userId = request.user.sub;
          const isReferent = menage.prestataire_user_id === userId;
          const isMultiAssigned = !!(await fastify.db('menage_prestataire')
            .where({ menage_id: menage.id, user_id: userId })
            .first());
          const isLogementMember = !!(await fastify.db('logement_member')
            .where({ logement_id: menage.logement_id, user_id: userId, role: 'prestataire' })
            .first());
          if (!isReferent && !isMultiAssigned && !isLogementMember) {
            return reply.code(403).send({
              statusCode: 403,
              error: 'Forbidden',
              message: "Tu n'as pas accès à ce ménage pour demander un changement",
            });
          }
        }
        // Bloquer si menage déjà terminé/validé
        if (['termine', 'valide', 'annule'].includes(menage.status)) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Le ménage est déjà terminé, validé ou annulé',
          });
        }
        const row = await service.create({
          menage_id: data.menage_id,
          requested_by: request.user.sub,
          original_date: menage.date_prevue,
          proposed_date: data.proposed_date,
          proposed_time: data.proposed_time ?? null,
          reason: data.reason ?? null,
        });

        // Notification push aux admins de l'organisation.
        (async () => {
          const admins = (await fastify.db('organization_member')
            .where({ organization_id: menage.organization_id, role: 'admin' })
            .select('user_id')) as { user_id: string }[];
          const recipients = admins.map((a) => a.user_id).filter((uid) => uid !== request.user.sub);
          if (recipients.length === 0) return;
          const presta = await fastify.db('user')
            .where({ id: request.user.sub })
            .select('first_name', 'last_name')
            .first();
          const name = presta ? `${presta.first_name} ${presta.last_name}`.trim() : 'Un prestataire';
          const dateLabel = new Date(menage.date_prevue).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
          });
          await sendPushToUsers(fastify.db, recipients, {
            title: 'Demande de report',
            body: `${name} demande à reporter le ménage du ${dateLabel}.`,
            data: { menage_id: menage.id, type: 'reschedule_request' },
          });
        })().catch((err) => fastify.log.error({ err }, 'push reschedule create failed'));

        return reply.code(201).send(row);
      },
    );

    // POST /reschedule-requests/:id/decide — admin
    fastify.post(
      '/reschedule-requests/:id/decide',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = decideRescheduleRequestSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Request not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        const menage = await fastify.db('menage').where({ id: existing.menage_id }).first();
        if (!menage || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Request not found');
        }
        if (existing.status !== 'pending') {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Cette demande est déjà traitée',
          });
        }
        const updated = await service.decide(
          id,
          data.decision,
          request.user.sub,
          data.decision_reason,
          data.apply_to_menage,
        );

        // Notification push au prestataire qui a fait la demande.
        if (existing.requested_by !== request.user.sub) {
          const approved = data.decision === 'approved';
          const dateLabel = new Date(menage.date_prevue).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
          });
          sendPushToUsers(fastify.db, [existing.requested_by], {
            title: approved ? 'Demande de report acceptée' : 'Demande de report refusée',
            body: approved
              ? `Ta demande pour le ménage du ${dateLabel} a été acceptée.`
              : `Ta demande pour le ménage du ${dateLabel} a été refusée.`,
            data: { menage_id: existing.menage_id, type: 'reschedule_decision' },
          }).catch((err) => fastify.log.error({ err }, 'push reschedule decide failed'));
        }

        return updated;
      },
    );

    // POST /reschedule-requests/:id/cancel — l'auteur de la demande
    fastify.post(
      '/reschedule-requests/:id/cancel',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Request not found');
        if (existing.requested_by !== request.user.sub) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' });
        }
        const updated = await service.cancel(id, request.user.sub);
        if (!updated) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'La demande n\'est plus en attente',
          });
        }
        // Prévenir les admins que la demande de report a été annulée.
        notifyRescheduleCancelled(fastify.db, existing.menage_id, request.user.sub).catch((err) =>
          fastify.log.error({ err }, 'push reschedule cancel failed'),
        );
        return updated;
      },
    );

    done();
  },
  { name: 'menage-reschedule-request-module' },
);
