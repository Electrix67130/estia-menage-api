import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import AuthService from './auth.service';
import { registerSchema, loginSchema, refreshSchema, updatePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schema';
import OrganizationMemberService from '../organization-member/organization-member.service';
import { signFields } from '@/lib/sign-url';

const switchOrganizationSchema = z.object({
  organization_id: z.string().uuid(),
});

export default fp(
  (fastify: FastifyInstance, _opts, done) => {
    const authService = new AuthService(fastify);

    fastify.post('/auth/register', async (request, reply) => {
      const data = registerSchema.parse(request.body);
      const result = await authService.register(data);
      return reply.code(201).send(result);
    });

    fastify.post('/auth/login', async (request, reply) => {
      const { email, password, platform } = loginSchema.parse(request.body);
      const result = await authService.login(email, password, platform);
      return reply.send(result);
    });

    fastify.post('/auth/refresh', async (request, reply) => {
      const { refresh_token } = refreshSchema.parse(request.body);
      const result = await authService.refresh(refresh_token);
      return reply.send(result);
    });

    fastify.post('/auth/logout', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      // Optionnel : si le client envoie son refresh_token, on supprime seulement
      // celui-là (logout par device). Sinon on tombe sur le comportement legacy
      // (efface tous les refresh tokens de l'user) pour rétro-compat.
      const body = (request.body ?? {}) as { refresh_token?: string };
      await authService.logout(request.user.sub, body.refresh_token);
      return reply.code(204).send();
    });

    fastify.post('/auth/forgot-password', async (request, reply) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const result = await authService.forgotPassword(email);
      return reply.send(result);
    });

    fastify.post('/auth/reset-password', async (request, reply) => {
      const { token, new_password } = resetPasswordSchema.parse(request.body);
      const result = await authService.resetPassword(token, new_password);
      return reply.send(result);
    });

    fastify.post('/auth/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { current_password, new_password } = updatePasswordSchema.parse(request.body);
      const result = await authService.updatePassword(request.user.sub, current_password, new_password);
      return reply.send(result);
    });

    fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const user = await fastify.db('user').where({ id: request.user.sub }).first();
      if (!user) return reply.notFound('User not found');
      const { password_hash: _password_hash, role: _legacyRole, organization_id: _legacyOrg, ...safeUser } = user;

      // On charge les memberships + on derive role + organization_id depuis la membership ACTIVE.
      // Cela permet aux clients existants de continuer a utiliser user.role / user.organization_id
      // en s'appuyant sur la membership active comme source de verite.
      const memberService = new OrganizationMemberService(fastify.db);
      const memberships = await memberService.findByUser(user.id);
      const active = user.active_organization_id
        ? memberships.find((m) => m.organization_id === user.active_organization_id)
        : memberships[0];

      return {
        ...signFields(safeUser, ['avatar_url', 'avatar_thumbnail_url']),
        role: active?.role ?? null,
        organization_id: active?.organization_id ?? null,
        active_organization_id: user.active_organization_id ?? null,
        memberships: memberships.map((m) => ({
          organization_id: m.organization_id,
          organization_name: m.organization_name,
          role: m.role,
        })),
      };
    });

    // POST /auth/switch-organization — change l'organisation active.
    // Le user doit avoir une membership pour l'org cible.
    fastify.post('/auth/switch-organization', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { organization_id } = switchOrganizationSchema.parse(request.body);
      const memberService = new OrganizationMemberService(fastify.db);
      const membership = await memberService.findByUserAndOrg(request.user.sub, organization_id);
      if (!membership) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Vous n\'etes pas membre de cette organisation',
        });
      }
      await fastify.db('user').where({ id: request.user.sub }).update({ active_organization_id: organization_id });
      return { active_organization_id: organization_id, role: membership.role };
    });

    done();
  },
  { name: 'auth-module' },
);
