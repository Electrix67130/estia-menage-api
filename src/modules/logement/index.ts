import fp from 'fastify-plugin';
import { z } from 'zod';
import LogementService from './logement.service';
import { createLogementSchema, updateLogementSchema, LogementRow } from './logement.schema';
import LogementRoomService from '@/modules/logement-room/logement-room.service';
import { getActiveMembership } from '@/lib/active-membership';
import { geocodeAddress } from '@/lib/geocode';

/**
 * Si l'utilisateur n'a pas fourni de coordonnées explicites mais a fourni
 * une adresse, on tente de geocoder via BAN. Best-effort : un échec ne
 * bloque pas la création/modification.
 */
async function maybeFillCoords<T extends { address?: string | null; postal_code?: string | null; city?: string | null; latitude?: number | null; longitude?: number | null }>(
  data: T,
): Promise<T> {
  if (data.latitude != null && data.longitude != null) return data;
  if (!data.address && !data.city) return data;
  const result = await geocodeAddress({
    address: data.address ?? null,
    postal_code: data.postal_code ?? null,
    city: data.city ?? null,
  });
  if (!result) return data;
  return { ...data, latitude: result.latitude, longitude: result.longitude };
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new LogementService(fastify.db);
    const roomService = new LogementRoomService(fastify.db);

    // GET /logements — liste des logements actifs de l'organisation active
    // Admin : tous les logements de l'org. Non-admin : uniquement ceux où il
    // est `logement_member` (peu importe son rôle dans le logement).
    fastify.get('/logements', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const pagination = paginationSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'No active organization',
        });
      }
      const restrictToMember = membership.role !== 'admin' ? request.user.sub : undefined;
      return service.findActiveByOrg(membership.organization_id, pagination, restrictToMember);
    });

    // GET /logements/:id — admin OK ; non-admin doit être membre du logement
    fastify.get('/logements/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return reply.notFound('Logement not found');
      const logement = await service.findById(id);
      if (!logement || logement.organization_id !== membership.organization_id) {
        return reply.notFound('Logement not found');
      }
      if (membership.role !== 'admin') {
        const isMember = await fastify.db('logement_member')
          .where({ logement_id: id, user_id: request.user.sub })
          .first();
        if (!isMember) return reply.notFound('Logement not found');
      }
      return logement;
    });

    // POST /logements — admin only
    fastify.post('/logements', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createLogementSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Seul un administrateur peut créer un logement',
        });
      }
      const enriched = await maybeFillCoords(data);
      const row = await service.create({
        ...enriched,
        created_by: request.user.sub,
        organization_id: membership.organization_id,
      });
      // Génère automatiquement les pièces (Chambre 1, Chambre 2, SDB, Salon, ...)
      // selon les counts saisis. Pas bloquant : si ça plante, le logement existe
      // déjà — un PATCH suivant pourra re-générer.
      try {
        await roomService.generateForLogement(row.id, {
          n_bedrooms: row.n_bedrooms,
          n_bathrooms: row.n_bathrooms,
          n_wc: row.n_wc,
          n_kitchens: row.n_kitchens,
          n_living_rooms: row.n_living_rooms,
          n_exterior_spaces: row.n_exterior_spaces,
          has_basement: row.has_basement,
          has_laundry: row.has_laundry,
        });
      } catch (err) {
        fastify.log.error({ err, logementId: row.id }, 'failed to auto-generate rooms');
      }
      return reply.code(201).send(row);
    });

    // PATCH /logements/:id — admin
    fastify.patch('/logements/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateLogementSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      const existing = await service.findById(id);
      if (!existing || existing.organization_id !== membership?.organization_id) {
        return reply.notFound('Logement not found');
      }
      if (membership?.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Seul un administrateur peut modifier un logement',
        });
      }
      // Si l'adresse change et qu'aucune coord n'est fournie explicitement, re-geocode.
      const addressChanged =
        ('address' in data && data.address !== existing.address) ||
        ('city' in data && data.city !== existing.city) ||
        ('postal_code' in data && data.postal_code !== existing.postal_code);
      const enriched =
        addressChanged && data.latitude == null && data.longitude == null
          ? await maybeFillCoords({
              address: data.address ?? existing.address,
              postal_code: data.postal_code ?? existing.postal_code,
              city: data.city ?? existing.city,
              ...data,
            })
          : data;
      const updated = await service.update(id, enriched);
      // Ajoute les pièces manquantes si l'admin a augmenté un count (ex : 2→3
      // chambres). Les pièces existantes ne sont pas touchées. La suppression
      // d'une pièce reste manuelle via /logement-rooms/:id.
      if (updated) {
        try {
          await roomService.generateForLogement(updated.id, {
            n_bedrooms: updated.n_bedrooms,
            n_bathrooms: updated.n_bathrooms,
            n_wc: updated.n_wc,
            n_kitchens: updated.n_kitchens,
            n_living_rooms: updated.n_living_rooms,
            n_exterior_spaces: updated.n_exterior_spaces,
            has_basement: updated.has_basement,
            has_laundry: updated.has_laundry,
          });
        } catch (err) {
          fastify.log.error({ err, logementId: updated.id }, 'failed to refresh rooms');
        }
      }
      return updated;
    });

    // POST /logements/:id/geocode — relance le geocoding pour un logement existant (admin)
    fastify.post(
      '/logements/:id/geocode',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        const existing = await service.findById(id);
        if (!existing || existing.organization_id !== membership?.organization_id) {
          return reply.notFound('Logement not found');
        }
        if (membership.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin only',
          });
        }
        const result = await geocodeAddress({
          address: existing.address,
          postal_code: existing.postal_code,
          city: existing.city,
        });
        if (!result) {
          return reply.code(422).send({
            statusCode: 422,
            error: 'Unprocessable',
            message: 'Adresse introuvable (BAN)',
          });
        }
        const updated = await service.update(id, {
          latitude: result.latitude,
          longitude: result.longitude,
        } as Partial<LogementRow>);
        return updated;
      },
    );

    // POST /logements/geocode-missing — backfill en masse (admin)
    fastify.post(
      '/logements/geocode-missing',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (membership?.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin only',
          });
        }
        const targets = (await fastify.db('logement')
          .where({ organization_id: membership.organization_id })
          .whereNull('archived_at')
          .where((qb) => qb.whereNull('latitude').orWhereNull('longitude'))
          .whereNotNull('address')) as LogementRow[];
        let geocoded = 0;
        const failed: { id: string; name: string }[] = [];
        for (const l of targets) {
          const r = await geocodeAddress({
            address: l.address,
            postal_code: l.postal_code,
            city: l.city,
          });
          if (r) {
            await service.update(l.id, {
              latitude: r.latitude,
              longitude: r.longitude,
            } as Partial<LogementRow>);
            geocoded++;
          } else {
            failed.push({ id: l.id, name: l.name });
          }
        }
        return { total: targets.length, geocoded, failed };
      },
    );

    // DELETE /logements/:id — soft archive
    fastify.delete('/logements/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      const existing = await service.findById(id);
      if (!existing || existing.organization_id !== membership?.organization_id) {
        return reply.notFound('Logement not found');
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
    });

    done();
  },
  { name: 'logement-module' },
);
