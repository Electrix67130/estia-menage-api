import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { logAudit, requireSuperAdmin } from '@/lib/super-admin';
import { paginationSchema, uuidParamSchema } from './super-admin.schema';
import FeedbackService from '@/modules/feedback/feedback.service';
import { listFeedbackSchema, respondFeedbackSchema } from '@/modules/feedback/feedback.schema';
import { notifyFeedbackReply } from '@/lib/push';

const SALT_ROUNDS = 10;

/**
 * Console super admin : vue transverse à toutes les organisations.
 *
 * Réservée au porteur du produit (`user.is_super_admin`, posé en SQL). Toute
 * action d'écriture est tracée dans `audit_log` : agir sur les données de
 * quelqu'un d'autre doit rester attribuable.
 */
export default fp(
  (fastify, _opts, done) => {
    const guard = [fastify.authenticate, requireSuperAdmin(fastify)];
    const feedbacks = new FeedbackService(fastify.db);

    // ---------- Vue d'ensemble ----------
    fastify.get('/super-admin/overview', { preHandler: guard }, async () => {
      const [
        [{ orgs_total }],
        [{ orgs_active }],
        [{ users_total }],
        [{ users_active }],
        [{ menages_active }],
        [{ menages_archived }],
        recentOrgs,
        recentUsers,
      ] = await Promise.all([
        fastify.db('organization').count('* as orgs_total') as unknown as Promise<
          { orgs_total: string }[]
        >,
        fastify.db('organization').where('is_active', true).count('* as orgs_active') as unknown as Promise<
          { orgs_active: string }[]
        >,
        fastify.db('user').count('* as users_total') as unknown as Promise<{ users_total: string }[]>,
        fastify.db('user').where('is_active', true).count('* as users_active') as unknown as Promise<
          { users_active: string }[]
        >,
        fastify.db('menage').whereNull('archived_at').count('* as menages_active') as unknown as Promise<
          { menages_active: string }[]
        >,
        fastify
          .db('menage')
          .whereNotNull('archived_at')
          .count('* as menages_archived') as unknown as Promise<{ menages_archived: string }[]>,
        fastify.db('organization').select('id', 'name', 'created_at').orderBy('created_at', 'desc').limit(5),
        fastify
          .db('user')
          .select('id', 'email', 'first_name', 'last_name', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(5),
      ]);

      // Sièges facturables : admins et prestataires (les deux rôles d'org).
      const billableRows = (await fastify
        .db('organization_member')
        .whereIn('role', ['admin', 'prestataire'])
        .count('* as count')) as { count: string }[];
      const billable_seats = parseInt(billableRows[0].count, 10);

      return {
        orgs: { total: parseInt(orgs_total, 10), active: parseInt(orgs_active, 10) },
        users: { total: parseInt(users_total, 10), active: parseInt(users_active, 10) },
        menages: {
          active: parseInt(menages_active, 10),
          archived: parseInt(menages_archived, 10),
        },
        billing: { billable_seats, estimated_monthly_eur: billable_seats * 10 },
        recent_orgs: recentOrgs,
        recent_users: recentUsers,
      };
    });

    // ---------- Organisations ----------
    fastify.get('/super-admin/orgs', { preHandler: guard }, async (request) => {
      const { page, limit, q } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const baseQuery = fastify.db('organization');
      if (q) baseQuery.whereILike('name', `%${q}%`);

      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];
      const rows = await baseQuery
        .clone()
        .leftJoin('organization_member', 'organization_member.organization_id', 'organization.id')
        .leftJoin('menage', function () {
          this.on('menage.organization_id', '=', 'organization.id').andOnNull('menage.archived_at');
        })
        .select(
          'organization.id',
          'organization.name',
          'organization.is_active',
          'organization.archive_retention_years',
          'organization.created_at',
        )
        .countDistinct('organization_member.user_id as member_count')
        .countDistinct('menage.id as menage_count')
        .groupBy('organization.id')
        .orderBy('organization.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows.map((r) => ({
          ...r,
          member_count: parseInt(String(r.member_count), 10),
          menage_count: parseInt(String(r.menage_count), 10),
        })),
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    fastify.get('/super-admin/orgs/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const org = await fastify.db('organization').where({ id }).first();
      if (!org) return reply.notFound('Organization not found');

      const [members, menages] = await Promise.all([
        fastify
          .db('organization_member')
          .join('user', 'user.id', 'organization_member.user_id')
          .where('organization_member.organization_id', id)
          .select(
            'user.id',
            'user.email',
            'user.first_name',
            'user.last_name',
            'user.is_active',
            'organization_member.role',
            'organization_member.created_at as joined_at',
          )
          .orderBy('organization_member.created_at', 'asc'),
        fastify
          .db('menage')
          .leftJoin('logement', 'logement.id', 'menage.logement_id')
          .where('menage.organization_id', id)
          .select(
            'menage.id',
            'menage.status',
            'menage.prestation_type',
            'menage.date_prevue',
            'menage.archived_at',
            'menage.created_at',
            'logement.name as logement_name',
          )
          .orderBy('menage.created_at', 'desc')
          .limit(50),
      ]);

      return { ...org, members, menages };
    });

    fastify.post('/super-admin/orgs/:id/disable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('organization').where({ id }).update({ is_active: false });
      if (!updated) return reply.notFound('Organization not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.disable',
        target_type: 'organization',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post('/super-admin/orgs/:id/enable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('organization').where({ id }).update({ is_active: true });
      if (!updated) return reply.notFound('Organization not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.enable',
        target_type: 'organization',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    /**
     * Impersonation : signe un JWT au nom d'un admin de l'org, valable 30 min.
     * Sert au support (« je ne vois pas mes ménages »). Tracé, évidemment.
     */
    fastify.post('/super-admin/orgs/:id/impersonate', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const adminMembership = await fastify
        .db('organization_member')
        .where({ organization_id: id, role: 'admin' })
        .first();
      if (!adminMembership) return reply.notFound('No admin in this organization');

      const targetUser = await fastify
        .db('user')
        .where({ id: adminMembership.user_id })
        .select('id', 'email')
        .first();
      if (!targetUser) return reply.notFound('No admin in this organization');

      const accessToken = fastify.jwt.sign(
        { sub: targetUser.id, email: targetUser.email, impersonated_by: request.user.sub },
        { expiresIn: '30m' },
      );

      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'org.impersonate',
        target_type: 'organization',
        target_id: id,
        metadata: { as_user_id: adminMembership.user_id },
        ip: request.ip,
      });

      return { access_token: accessToken, user_id: adminMembership.user_id };
    });

    // ---------- Utilisateurs ----------
    fastify.get('/super-admin/users', { preHandler: guard }, async (request) => {
      const { page, limit, q } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const baseQuery = fastify.db('user');
      if (q) {
        baseQuery.where(function () {
          this.whereILike('email', `%${q}%`)
            .orWhereILike('first_name', `%${q}%`)
            .orWhereILike('last_name', `%${q}%`);
        });
      }

      const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];
      const rows = await baseQuery
        .clone()
        .select(
          'id',
          'email',
          'first_name',
          'last_name',
          'phone',
          'is_active',
          'is_super_admin',
          'created_at',
        )
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    fastify.get('/super-admin/users/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const user = await fastify.db('user').where({ id }).first();
      if (!user) return reply.notFound('User not found');
      const { password_hash: _ph, ...safe } = user;

      const memberships = await fastify
        .db('organization_member')
        .join('organization', 'organization.id', 'organization_member.organization_id')
        .where('organization_member.user_id', id)
        .select(
          'organization.id as organization_id',
          'organization.name as organization_name',
          'organization.is_active',
          'organization_member.role',
        );

      const [{ session_count }] = (await fastify
        .db('refresh_token')
        .where({ user_id: id })
        .count('* as session_count')) as { session_count: string }[];

      return { ...safe, memberships, active_sessions: parseInt(session_count, 10) };
    });

    fastify.post('/super-admin/users/:id/disable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('user').where({ id }).update({ is_active: false });
      if (!updated) return reply.notFound('User not found');
      // Désactiver sans couper les sessions ne désactive rien : le token en
      // cours resterait valable.
      await fastify.db('refresh_token').where({ user_id: id }).del();
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.disable',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post('/super-admin/users/:id/enable', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const updated = await fastify.db('user').where({ id }).update({ is_active: true });
      if (!updated) return reply.notFound('User not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.enable',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return { ok: true };
    });

    fastify.post(
      '/super-admin/users/:id/kick-sessions',
      { preHandler: guard },
      async (request) => {
        const { id } = uuidParamSchema.parse(request.params);
        const deleted = await fastify.db('refresh_token').where({ user_id: id }).del();
        await logAudit(fastify.db, {
          super_admin_id: request.user.sub,
          action: 'user.kick_sessions',
          target_type: 'user',
          target_id: id,
          metadata: { sessions_killed: deleted },
          ip: request.ip,
        });
        return { ok: true, sessions_killed: deleted };
      },
    );

    /**
     * Mot de passe temporaire : remplace le hash et coupe les sessions. Le super
     * admin récupère le mot de passe pour le transmettre de vive voix.
     */
    fastify.post('/super-admin/users/:id/force-reset', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const user = await fastify.db('user').where({ id }).first();
      if (!user) return reply.notFound('User not found');

      const tempPassword = `Tmp-${randomUUID().slice(0, 12)}`;
      const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      await fastify.db('user').where({ id }).update({ password_hash: hash });
      await fastify.db('refresh_token').where({ user_id: id }).del();

      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.force_reset',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });

      return { ok: true, temporary_password: tempPassword };
    });

    fastify.delete('/super-admin/users/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      if (id === request.user.sub) {
        return reply
          .code(400)
          .send({ statusCode: 400, error: 'Bad Request', message: 'Cannot delete yourself' });
      }
      const deleted = await fastify.db('user').where({ id }).del();
      if (!deleted) return reply.notFound('User not found');
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'user.delete',
        target_type: 'user',
        target_id: id,
        ip: request.ip,
      });
      return reply.code(204).send();
    });

    // ---------- Signalements (toutes organisations) ----------
    fastify.get('/super-admin/feedbacks', { preHandler: guard }, async (request) => {
      const filters = listFeedbackSchema.parse(request.query);
      const [result, counts] = await Promise.all([
        feedbacks.findForSupport(filters),
        feedbacks.countByStatus(),
      ]);
      return { ...result, counts };
    });

    fastify.get('/super-admin/feedbacks/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const feedback = await feedbacks.findByIdForSupport(id);
      if (!feedback) return reply.notFound('Signalement introuvable');
      return feedback;
    });

    fastify.patch('/super-admin/feedbacks/:id', { preHandler: guard }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const data = respondFeedbackSchema.parse(request.body);

      const existing = await feedbacks.findById(id);
      if (!existing) return reply.notFound('Signalement introuvable');

      const feedback = await feedbacks.respond(id, data, request.user.sub);

      // Notifier l'auteur uniquement sur une réponse NOUVELLE : un changement
      // de statut ne vaut pas d'interrompre quelqu'un.
      const newResponse =
        typeof data.response === 'string' && data.response !== (existing.response ?? null);
      if (newResponse && existing.user_id !== request.user.sub) {
        notifyFeedbackReply(fastify.db, existing.user_id, id, existing.subject).catch((err) =>
          fastify.log.error({ err, feedback_id: id }, 'push feedback reply failed'),
        );
      }

      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'feedback.respond',
        target_type: 'feedback',
        target_id: id,
        metadata: { status: feedback?.status, answered: data.response != null },
        ip: request.ip,
      });

      return feedback;
    });

    // ---------- Journal d'audit ----------
    fastify.get('/super-admin/audit', { preHandler: guard }, async (request) => {
      const { page, limit } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const [{ count }] = (await fastify.db('audit_log').count('* as count')) as { count: string }[];
      const rows = await fastify
        .db('audit_log')
        .leftJoin('user', 'user.id', 'audit_log.super_admin_id')
        .select(
          'audit_log.*',
          'user.email as super_admin_email',
          'user.first_name as super_admin_first_name',
          'user.last_name as super_admin_last_name',
        )
        .orderBy('audit_log.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    // ---------- Journal d'erreurs (Sentry maison) ----------
    fastify.get('/super-admin/errors', { preHandler: guard }, async (request) => {
      const { page, limit } = paginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const [{ count }] = (await fastify.db('error_log').count('* as count')) as { count: string }[];
      const rows = await fastify
        .db('error_log')
        .leftJoin('user', 'user.id', 'error_log.user_id')
        .select('error_log.*', 'user.email as user_email')
        .orderBy('error_log.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        meta: {
          total: parseInt(count, 10),
          page,
          limit,
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      };
    });

    done();
  },
  { name: 'super-admin-module' },
);
