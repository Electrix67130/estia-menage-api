import fp from 'fastify-plugin';
import { z } from 'zod';
import MenageService from './menage.service';
import MenagePrestataireService from '@/modules/menage-prestataire/menage-prestataire.service';
import {
  createMenageSchema,
  updateMenageSchema,
  validateReportSchema,
  pointageSchema,
  listMenagesSchema,
  serializeMenageForRole,
} from './menage.schema';
import { getActiveMembership } from '@/lib/active-membership';
import {
  requirePermissionForMenage,
  requirePermissionForLogement,
} from '@/lib/permissions';
import { emitToMenage } from '@/lib/realtime-hub';
import { notifyMenageAssignment, notifyMenageAvailable } from '@/lib/push';
import { signUrlsInList } from '@/lib/sign-url';

const uuidSchema = z.object({ id: z.string().uuid() });

const earningsQuerySchema = z.object({
  from: z.string().optional(), // YYYY-MM-DD
  to: z.string().optional(),
  /** Si fourni : ne compte que les ménages validés, sinon tous les terminés/validés */
  validated_only: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : v))
    .optional(),
});

export default fp(
  (fastify, _opts, done) => {
    const service = new MenageService(fastify.db);

    // GET /menages — filterable list. Non-admins ne voient que les ménages où ils
    // sont prestataire OU membre du logement.
    fastify.get('/menages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const query = listMenagesSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'No active organization',
        });
      }
      const isAdmin = membership.role === 'admin';
      const { manager, ...rest } = query;
      const result = await service.findActive(membership.organization_id, {
        ...rest,
        managerUserId: manager === 'me' || !isAdmin ? request.user.sub : undefined,
        restrictToMember: !isAdmin,
      });
      return {
        ...result,
        data: result.data.map((m) =>
          serializeMenageForRole(m, {
            isAdmin,
            isPrestataire: m.prestataire_user_id === request.user.sub,
          }),
        ),
      };
    });

    // GET /menages/:id
    fastify.get('/menages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const menage = await service.findByIdWithPrestataire(id);
      if (!menage) return reply.notFound('Menage not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership || menage.organization_id !== membership.organization_id) {
        return reply.notFound('Menage not found');
      }
      const isAdmin = membership.role === 'admin';
      const isPrestataire = menage.prestataire_user_id === request.user.sub;
      if (!isAdmin && !isPrestataire) {
        await requirePermissionForLogement(
          fastify.db,
          request.user.sub,
          menage.logement_id,
          'view_comments',
        );
      }
      return serializeMenageForRole(menage, { isAdmin, isPrestataire });
    });

    // GET /menages/:id/eligible-prestataires — TOUS les prestataires de l'org,
    // avec un flag `is_member` indiquant s'ils sont membres du logement parent.
    // Les membres reçoivent tous les ménages du logement ; les non-membres
    // peuvent être affectés ponctuellement (remplacement) à ce ménage seul.
    fastify.get(
      '/menages/:id/eligible-prestataires',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const menage = await service.findById(id);
        if (!menage) return reply.notFound('Menage not found');
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || menage.organization_id !== membership.organization_id) {
          return reply.notFound('Menage not found');
        }
        if (membership.role !== 'admin') {
          await requirePermissionForLogement(
            fastify.db,
            request.user.sub,
            menage.logement_id,
            'view_team',
          );
        }
        const data = await fastify.db('organization_member')
          .join('user', 'organization_member.user_id', 'user.id')
          .where({
            'organization_member.organization_id': menage.organization_id,
            'organization_member.role': 'prestataire',
          })
          .select(
            'user.id',
            'user.first_name',
            'user.last_name',
            'user.email',
            'user.avatar_url',
            fastify.db.raw(
              `EXISTS (SELECT 1 FROM logement_member lm WHERE lm.logement_id = ? AND lm.user_id = "user".id AND lm.role = 'prestataire') as is_member`,
              [menage.logement_id],
            ),
          )
          .orderBy('user.first_name', 'asc');
        return { data: signUrlsInList(data, ['avatar_url']) };
      },
    );

    // POST /menages — admin only, auto-génère la checklist (hook phase 5)
    fastify.post('/menages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createMenageSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Seul un administrateur peut créer un ménage',
        });
      }
      const logement = await fastify.db('logement').where({ id: data.logement_id }).first();
      if (!logement || logement.organization_id !== membership.organization_id) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Logement introuvable dans votre organisation',
        });
      }
      if (data.prestataire_user_id) {
        const member = await fastify.db('logement_member')
          .where({ logement_id: data.logement_id, user_id: data.prestataire_user_id })
          .first();
        if (!member) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Le prestataire doit être membre du logement',
          });
        }
      }
      const menage = await service.createWithChecklist(
        {
          ...data,
          created_by: request.user.sub,
          organization_id: membership.organization_id,
        },
        logement,
      );

      // Notif push à la création :
      // - assigné directement → on prévient le prestataire concerné ;
      // - sinon → on signale aux prestataires du logement qu'un ménage est dispo.
      if (data.prestataire_user_id) {
        if (data.prestataire_user_id !== request.user.sub) {
          notifyMenageAssignment(fastify.db, menage.id, [data.prestataire_user_id]).catch((err) =>
            fastify.log.error({ err }, 'push assignment (create) failed'),
          );
        }
      } else {
        notifyMenageAvailable(fastify.db, menage.id, request.user.sub).catch((err) =>
          fastify.log.error({ err }, 'push available (create) failed'),
        );
      }

      return reply.code(201).send(menage);
    });

    // PATCH /menages/:id — admin OR membre du logement avec can_edit.
    // Exception : modifier prestataire_user_id (affecter/changer/désaffecter) = admin uniquement.
    fastify.patch('/menages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateMenageSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Menage not found');

      const isPrestataireChange =
        'prestataire_user_id' in data && data.prestataire_user_id !== existing.prestataire_user_id;
      // Édition manuelle de arrived_at/departed_at = admin uniquement (correction
      // a posteriori si le prestataire a oublié de pointer ou s'est trompé).
      const isTimestampEdit = 'arrived_at' in data || 'departed_at' in data;

      if (isPrestataireChange || isTimestampEdit) {
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (
          membership?.role !== 'admin' ||
          existing.organization_id !== membership.organization_id
        ) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: isTimestampEdit
              ? "Seul un administrateur peut modifier les heures d'arrivée/départ"
              : 'Seul un administrateur peut affecter un prestataire à un ménage',
          });
        }
      } else {
        await requirePermissionForMenage(fastify.db, request.user.sub, id, 'edit');
      }

      if (data.prestataire_user_id) {
        const member = await fastify.db('logement_member')
          .where({ logement_id: existing.logement_id, user_id: data.prestataire_user_id })
          .first();
        if (!member) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Le prestataire doit être membre du logement',
          });
        }
      }
      // Si l'admin change manuellement la date d'un ménage rattaché à un
      // calendrier externe (Airbnb...), on verrouille la date par défaut pour
      // éviter que la prochaine sync iCal n'écrase la valeur. Sauf si l'admin
      // a explicitement fourni `date_locked` dans le payload (cas du toggle).
      const dataWithLock: typeof data = { ...data };
      if (
        !('date_locked' in data) &&
        'date_prevue' in data &&
        data.date_prevue &&
        data.date_prevue !== existing.date_prevue &&
        existing.external_calendar_id
      ) {
        (dataWithLock as Record<string, unknown>).date_locked = true;
      }
      const menage = await service.update(id, dataWithLock);

      // Sync de la table de jointure `menage_prestataire` si on touche au
      // prestataire singulier (rétro-compat : PATCH historique remplace toute
      // la liste par [user] ou vide la liste si null).
      if (isPrestataireChange) {
        const presta = new MenagePrestataireService(fastify.db);
        const userIds = data.prestataire_user_id ? [data.prestataire_user_id] : [];
        await presta.setMenagePrestataires(id, userIds);

        // Notif push au prestataire nouvellement affecte (hors auteur).
        if (data.prestataire_user_id && data.prestataire_user_id !== request.user.sub) {
          notifyMenageAssignment(fastify.db, id, [data.prestataire_user_id]).catch((err) =>
            fastify.log.error({ err }, 'push assignment (patch) failed'),
          );
        }
      }

      return menage;
    });

    // DELETE /menages/:id — admin only
    fastify.delete('/menages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Menage not found');
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin' || existing.organization_id !== membership.organization_id) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Admin only',
        });
      }
      await service.delete(id);
      return reply.code(204).send();
    });

    // POST /menages/:id/arrival — prestataire assigné uniquement
    fastify.post(
      '/menages/:id/arrival',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { photo_url, lat, lng } = pointageSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Menage not found');
        if (existing.prestataire_user_id !== request.user.sub) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Seul le prestataire assigné peut pointer son arrivée',
          });
        }
        const updated = await service.recordArrival(id, { photoUrl: photo_url, lat, lng });
        emitToMenage(fastify.db, id, {
          type: 'menage.arrival',
          menage_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
        return updated;
      },
    );

    // POST /menages/:id/departure — prestataire assigné uniquement
    fastify.post(
      '/menages/:id/departure',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { photo_url, lat, lng } = pointageSchema.parse(request.body);
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Menage not found');
        if (existing.prestataire_user_id !== request.user.sub) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Seul le prestataire assigné peut pointer son départ',
          });
        }
        const updated = await service.recordDeparture(id, { photoUrl: photo_url, lat, lng });
        emitToMenage(fastify.db, id, {
          type: 'menage.departure',
          menage_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
        return updated;
      },
    );

    // POST /menages/:id/validate — manager / admin (via can_edit)
    fastify.post(
      '/menages/:id/validate',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = validateReportSchema.parse(request.body ?? {});
        const existing = await service.findById(id);
        if (!existing) return reply.notFound('Menage not found');
        await requirePermissionForMenage(fastify.db, request.user.sub, id, 'edit');
        const updated = await service.validateReport(id, request.user.sub, data.price);
        emitToMenage(fastify.db, id, {
          type: 'menage.validated',
          menage_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
        return updated;
      },
    );

    async function computeEarningsFor(
      userId: string,
      organizationId: string,
      opts: { from?: string; to?: string; validated_only?: boolean },
    ) {
      // Un presta voit le ménage dans ses gains s'il est référent
      // (`prestataire_user_id`) OU s'il est affecté via `menage_prestataire`
      // (cas multi-presta, remplacement ponctuel). Le `provider_price` recensé
      // est le total payé à l'équipe ; on l'attribue intégralement à chaque
      // presta qui l'a effectué (le split éventuel est géré hors-app).
      const query = fastify.db('menage')
        .where('menage.organization_id', organizationId)
        .whereNull('menage.archived_at')
        .where(function () {
          this.where('menage.prestataire_user_id', userId).orWhereExists(function () {
            this.select('*')
              .from('menage_prestataire')
              .whereRaw('menage_prestataire.menage_id = menage.id')
              .where('menage_prestataire.user_id', userId);
          });
        });

      if (opts.validated_only) {
        query.whereNotNull('menage.validated_at');
      } else {
        query.whereIn('menage.status', ['termine', 'valide']);
      }
      if (opts.from) query.where('menage.date_prevue', '>=', opts.from);
      if (opts.to) query.where('menage.date_prevue', '<=', opts.to);

      const rows = (await query
        .select(
          'menage.id',
          'menage.date_prevue',
          'menage.logement_id',
          'menage.status',
          'menage.provider_price',
          'menage.laundry_provider_price',
          'menage.laundry_included',
          'menage.validated_at',
        )
        .orderBy('menage.date_prevue', 'desc')) as Array<{
        id: string;
        date_prevue: string;
        logement_id: string;
        status: string;
        provider_price: string | number | null;
        laundry_provider_price: string | number | null;
        laundry_included: boolean;
        validated_at: string | null;
      }>;

      let totalCents = 0;
      const items = rows.map((r) => {
        const base = Number(r.provider_price ?? 0);
        const laundry = r.laundry_included ? Number(r.laundry_provider_price ?? 0) : 0;
        const subtotal = base + laundry;
        totalCents += Math.round(subtotal * 100);
        return {
          id: r.id,
          date_prevue: r.date_prevue,
          logement_id: r.logement_id,
          status: r.status,
          provider_price: r.provider_price,
          laundry_provider_price: r.laundry_provider_price,
          laundry_included: r.laundry_included,
          subtotal: Number(subtotal.toFixed(2)),
          validated_at: r.validated_at,
        };
      });

      return {
        total: Number((totalCents / 100).toFixed(2)),
        currency: 'EUR',
        count: items.length,
        from: opts.from ?? null,
        to: opts.to ?? null,
        items,
      };
    }

    // GET /me/earnings — bilan des gains du prestataire connecté
    fastify.get(
      '/me/earnings',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const opts = earningsQuerySchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'No active organization',
          });
        }
        return computeEarningsFor(request.user.sub, membership.organization_id, opts);
      },
    );

    // GET /users/:user_id/earnings — admin uniquement
    fastify.get(
      '/users/:user_id/earnings',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { user_id } = z.object({ user_id: z.string().uuid() }).parse(request.params);
        const opts = earningsQuerySchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || membership.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin uniquement',
          });
        }
        // Vérifier que le user appartient bien à la même org
        const target = await fastify.db('organization_member')
          .where({ user_id, organization_id: membership.organization_id })
          .first();
        if (!target) {
          return reply.code(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: "Utilisateur introuvable dans l'organisation",
          });
        }
        return computeEarningsFor(user_id, membership.organization_id, opts);
      },
    );

    // GET /admin/earnings — vue agrégée admin : total + breakdown par client + par presta.
    fastify.get(
      '/admin/earnings',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const opts = earningsQuerySchema.parse(request.query);
        const membership = await getActiveMembership(fastify.db, request.user.sub);
        if (!membership || membership.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin uniquement',
          });
        }
        return computeAdminEarnings(membership.organization_id, opts);
      },
    );

    async function computeAdminEarnings(
      organizationId: string,
      opts: { from?: string; to?: string; validated_only?: boolean },
    ) {
      const q = fastify.db('menage')
        .leftJoin('logement', 'menage.logement_id', 'logement.id')
        .leftJoin('client', 'logement.client_id', 'client.id')
        .where('menage.organization_id', organizationId)
        .whereNull('menage.archived_at');

      if (opts.validated_only) q.whereNotNull('menage.validated_at');
      else q.whereIn('menage.status', ['termine', 'valide']);
      if (opts.from) q.where('menage.date_prevue', '>=', opts.from);
      if (opts.to) q.where('menage.date_prevue', '<=', opts.to);

      const rows = (await q.select(
        'menage.id',
        'menage.provider_price',
        'menage.laundry_provider_price',
        'menage.laundry_included',
        'menage.prestataire_user_id',
        'logement.id as logement_id',
        'logement.name as logement_name',
        'client.id as client_id',
        'client.first_name as client_first_name',
        'client.last_name as client_last_name',
        'client.company_name as client_company_name',
      )) as Array<{
        id: string;
        provider_price: string | number | null;
        laundry_provider_price: string | number | null;
        laundry_included: boolean;
        prestataire_user_id: string | null;
        logement_id: string | null;
        logement_name: string | null;
        client_id: string | null;
        client_first_name: string | null;
        client_last_name: string | null;
        client_company_name: string | null;
      }>;

      // Charge tous les prestataires assignés en une requête.
      const ids = rows.map((r) => r.id);
      const assignments =
        ids.length === 0
          ? []
          : ((await fastify.db('menage_prestataire')
              .innerJoin('user', 'menage_prestataire.user_id', 'user.id')
              .whereIn('menage_prestataire.menage_id', ids)
              .select(
                'menage_prestataire.menage_id',
                'user.id',
                'user.first_name',
                'user.last_name',
              )) as { menage_id: string; id: string; first_name: string; last_name: string }[]);

      const prestasByMenage = new Map<string, { id: string; name: string }[]>();
      for (const a of assignments) {
        const list = prestasByMenage.get(a.menage_id) ?? [];
        list.push({ id: a.id, name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || a.id });
        prestasByMenage.set(a.menage_id, list);
      }

      type Bucket = { id: string; name: string; total: number; count: number };
      const byClient = new Map<string, Bucket>();
      const byPresta = new Map<string, Bucket>();
      let grandTotal = 0;

      for (const r of rows) {
        const base = Number(r.provider_price ?? 0);
        const laundry = r.laundry_included ? Number(r.laundry_provider_price ?? 0) : 0;
        const subtotal = base + laundry;
        grandTotal += subtotal;

        // by_client
        const clientKey = r.client_id ?? '__no_client__';
        const clientName =
          r.client_company_name ||
          [r.client_first_name, r.client_last_name].filter(Boolean).join(' ') ||
          'Sans client';
        const cb = byClient.get(clientKey) ?? { id: clientKey, name: clientName, total: 0, count: 0 };
        cb.total += subtotal;
        cb.count += 1;
        byClient.set(clientKey, cb);

        // by_presta : split equally entre tous les assignés. Fallback sur le
        // référent si pas d'entrée dans menage_prestataire (legacy).
        let prestas = prestasByMenage.get(r.id) ?? [];
        if (prestas.length === 0 && r.prestataire_user_id) {
          prestas = [{ id: r.prestataire_user_id, name: '—' }];
        }
        if (prestas.length === 0) continue;
        const share = subtotal / prestas.length;
        for (const p of prestas) {
          const pb = byPresta.get(p.id) ?? { id: p.id, name: p.name, total: 0, count: 0 };
          pb.total += share;
          pb.count += 1 / prestas.length;
          byPresta.set(p.id, pb);
        }
      }

      const round = (n: number) => Number(n.toFixed(2));
      return {
        total: round(grandTotal),
        currency: 'EUR',
        count: rows.length,
        from: opts.from ?? null,
        to: opts.to ?? null,
        by_client: Array.from(byClient.values())
          .map((b) => ({ ...b, total: round(b.total) }))
          .sort((a, b) => b.total - a.total),
        by_prestataire: Array.from(byPresta.values())
          .map((b) => ({ ...b, total: round(b.total), count: round(b.count) }))
          .sort((a, b) => b.total - a.total),
      };
    }

    done();
  },
  { name: 'menage-module' },
);
