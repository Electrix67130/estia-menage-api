import fp from 'fastify-plugin';
import { z } from 'zod';
import MenageEquipementService from './menage-equipement.service';
import {
  setMenageEquipementDoneSchema,
  setMenageEquipementsSchema,
} from './menage-equipement.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { requireMenageAccess } from '@/lib/permissions';

const uuidSchema = z.object({ id: z.string().uuid() });
const doneParamsSchema = z.object({
  id: z.string().uuid(),
  equipement_id: z.string().uuid(),
});

/**
 * Équipements à préparer pour une prestation (chaise haute, baignoire bébé…),
 * choisis par l'admin parmi l'inventaire du logement.
 *
 * **Écriture admin uniquement** : le prestataire consulte la liste sur sa
 * prestation, il ne coche rien (décision produit).
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new MenageEquipementService(fastify.db);

    // GET /menages/:id/equipements — tous ceux qui ont accès à la prestation
    fastify.get(
      '/menages/:id/equipements',
      { preHandler: [fastify.authenticate] },
      async (request) => {
        const { id } = uuidSchema.parse(request.params);
        await requireMenageAccess(fastify.db, request.user.sub, id, 'view_checklist');
        return service.findByMenage(id);
      },
    );

    // PUT /menages/:id/equipements — admin : définit la liste à préparer
    fastify.put(
      '/menages/:id/equipements',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = setMenageEquipementsSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const menage = await fastify.db('menage').where({ id }).first();
        if (!membership || !menage || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        if (membership.role !== 'admin') {
          return reply
            .code(403)
            .send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
        }
        // Les équipements demandés doivent appartenir au logement du ménage.
        if (data.items.length > 0) {
          const ids = data.items.map((i) => i.logement_equipement_id);
          const valid = (await fastify.db('logement_equipement')
            .whereIn('id', ids)
            .andWhere({ logement_id: menage.logement_id })
            .select('id')) as { id: string }[];
          if (valid.length !== new Set(ids).size) {
            return reply.code(400).send({
              statusCode: 400,
              error: 'Bad Request',
              message: "Un équipement n'appartient pas au logement de cette prestation",
            });
          }
        }
        return service.setForMenage(id, data);
      },
    );

    // PATCH /menages/:id/equipements/:equipement_id — admin uniquement
    fastify.patch(
      '/menages/:id/equipements/:equipement_id',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id, equipement_id } = doneParamsSchema.parse(request.params);
        const body = setMenageEquipementDoneSchema.parse(request.body);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const menage = await fastify.db('menage').where({ id }).first();
        if (!membership || !menage || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        // Décision produit : le prestataire est en LECTURE SEULE sur ce qu'il a
        // à préparer — il consulte, il ne coche pas. Seul l'admin suit l'état.
        if (membership.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin only',
          });
        }
        const line = await service.setDone(id, equipement_id, body.done, request.user.sub);
        if (!line) return reply.notFound('Equipement not found on this menage');
        return line;
      },
    );

    done();
  },
  { name: 'menage-equipement-module' },
);
