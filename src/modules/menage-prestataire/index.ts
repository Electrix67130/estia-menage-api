import fp from 'fastify-plugin';
import { z } from 'zod';
import MenagePrestataireService from './menage-prestataire.service';
import { setMenagePrestatairesSchema } from './menage-prestataire.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { notifyMenageAssignment, notifyMenageUnassigned } from '@/lib/push';

const menageIdParam = z.object({ id: z.string().uuid() });
const menageUserIdParam = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
});

/**
 * Endpoints multi-prestataires d'un ménage. Le picker côté UI peut sélectionner
 * plusieurs prestas → on appelle `PUT /menages/:id/prestataires` avec la liste
 * complète. Pour des micro-ajustements, `POST` et `DELETE` ajoutent/retirent
 * unitairement.
 *
 * Toutes les opérations d'affectation sont **admin only** (cf. logique
 * existante du PATCH /menages/:id sur prestataire_user_id).
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new MenagePrestataireService(fastify.db);

    const ensureAdmin = async (
      userId: string,
      menageId: string,
    ): Promise<{ ok: true } | { ok: false; code: number; message: string }> => {
      const membership = await getActiveMembership(fastify.db, userId);
      if (!membership || membership.role !== 'admin') {
        return { ok: false, code: 403, message: 'Seul un administrateur peut affecter un prestataire à un ménage' };
      }
      const menage = await fastify.db('menage').where({ id: menageId }).first();
      if (!menage) return { ok: false, code: 404, message: 'Menage not found' };
      if (menage.organization_id !== membership.organization_id) {
        return { ok: false, code: 404, message: 'Menage not found' };
      }
      return { ok: true };
    };

    // GET /menages/:id/prestataires — liste enrichie (user info + is_primary)
    fastify.get(
      '/menages/:id/prestataires',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = menageIdParam.parse(request.params);
        const menage = await fastify.db('menage').where({ id }).first();
        if (!menage) return reply.notFound('Menage not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        const data = await service.findByMenage(id);
        return { data };
      },
    );

    // PUT /menages/:id/prestataires — full-replace (admin only)
    fastify.put(
      '/menages/:id/prestataires',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = menageIdParam.parse(request.params);
        const { prestataire_user_ids } = setMenagePrestatairesSchema.parse(request.body);
        const guard = await ensureAdmin(request.user.sub, id);
        if (!guard.ok) {
          return reply.code(guard.code).send({
            statusCode: guard.code,
            error: guard.code === 403 ? 'Forbidden' : 'Not Found',
            message: guard.message,
          });
        }
        // Valide que chaque user_id est un prestataire de l'organisation. On
        // n'exige PLUS qu'il soit membre du logement : un presta peut être
        // affecté ponctuellement à un ménage (remplacement) sans recevoir tous
        // les ménages du logement.
        if (prestataire_user_ids.length > 0) {
          const menage = (await fastify.db('menage')
            .where({ id })
            .select('organization_id')
            .first()) as { organization_id: string };
          const members = (await fastify.db('organization_member')
            .where({ organization_id: menage.organization_id })
            .whereIn('user_id', prestataire_user_ids)
            .select('user_id', 'role')) as { user_id: string; role: string }[];
          const validIds = new Set(
            members.filter((m) => m.role === 'prestataire').map((m) => m.user_id),
          );
          const invalid = prestataire_user_ids.filter((u) => !validIds.has(u));
          if (invalid.length > 0) {
            return reply.code(400).send({
              statusCode: 400,
              error: 'Bad Request',
              message: `Les utilisateurs suivants ne sont pas prestataires de l'organisation : ${invalid.join(', ')}`,
            });
          }
        }
        // Prestataires deja affectes avant le remplacement, pour ne notifier que les nouveaux.
        const before = (await fastify.db('menage_prestataire')
          .where({ menage_id: id })
          .select('user_id')) as { user_id: string }[];
        const beforeSet = new Set(before.map((r) => r.user_id));

        await service.setMenagePrestataires(id, prestataire_user_ids);
        const data = await service.findByMenage(id);

        const newlyAssigned = prestataire_user_ids.filter(
          (u) => !beforeSet.has(u) && u !== request.user.sub,
        );
        notifyMenageAssignment(fastify.db, id, newlyAssigned).catch((err) =>
          fastify.log.error({ err }, 'push assignment failed'),
        );

        // Prestataires retirés par le remplacement → les prévenir.
        const removed = [...beforeSet].filter(
          (u) => !prestataire_user_ids.includes(u) && u !== request.user.sub,
        );
        notifyMenageUnassigned(fastify.db, id, removed).catch((err) =>
          fastify.log.error({ err }, 'push unassigned failed'),
        );

        return { data };
      },
    );

    // POST /menages/:id/prestataires/:user_id — add (admin only)
    fastify.post(
      '/menages/:id/prestataires/:user_id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id, user_id } = menageUserIdParam.parse(request.params);
        const guard = await ensureAdmin(request.user.sub, id);
        if (!guard.ok) {
          return reply.code(guard.code).send({
            statusCode: guard.code,
            error: guard.code === 403 ? 'Forbidden' : 'Not Found',
            message: guard.message,
          });
        }
        // Vérifie que le user est un prestataire de l'organisation (pas
        // forcément membre du logement → affectation ponctuelle possible).
        const menage = (await fastify.db('menage')
          .where({ id })
          .select('organization_id')
          .first()) as { organization_id: string };
        const member = await fastify.db('organization_member')
          .where({ organization_id: menage.organization_id, user_id, role: 'prestataire' })
          .first();
        if (!member) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: "Le prestataire doit appartenir à l'organisation",
          });
        }
        const alreadyAssigned = await fastify.db('menage_prestataire')
          .where({ menage_id: id, user_id })
          .first();
        await service.addPrestataire(id, user_id);
        const data = await service.findByMenage(id);

        if (!alreadyAssigned && user_id !== request.user.sub) {
          notifyMenageAssignment(fastify.db, id, [user_id]).catch((err) =>
            fastify.log.error({ err }, 'push assignment failed'),
          );
        }

        return { data };
      },
    );

    // DELETE /menages/:id/prestataires/:user_id — remove (admin only)
    fastify.delete(
      '/menages/:id/prestataires/:user_id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id, user_id } = menageUserIdParam.parse(request.params);
        const guard = await ensureAdmin(request.user.sub, id);
        if (!guard.ok) {
          return reply.code(guard.code).send({
            statusCode: guard.code,
            error: guard.code === 403 ? 'Forbidden' : 'Not Found',
            message: guard.message,
          });
        }
        await service.removePrestataire(id, user_id);

        // Prévenir le prestataire retiré (hors auteur).
        if (user_id !== request.user.sub) {
          notifyMenageUnassigned(fastify.db, id, [user_id]).catch((err) =>
            fastify.log.error({ err }, 'push unassigned failed'),
          );
        }

        return reply.code(204).send();
      },
    );

    done();
  },
  { name: 'menage-prestataire-module' },
);
