import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { randomUUID, createHmac } from 'crypto';
import UserService from '@/modules/user/user.service';
import { RegisterInput } from './auth.schema';
import { UserRow } from '@/modules/user/user.schema';
import env from '@/config/env';
import { invalidateSessionCache } from '@/lib/session-cache';

const SALT_ROUNDS = 12;

class AuthService {
  private fastify: FastifyInstance;
  private userService: UserService;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.userService = new UserService(fastify.db);
  }

  async register(data: RegisterInput) {
    let finalEmail = data.email;
    let finalRole = data.role;
    let finalCompanyName = data.company_name;
    let invitationId: string | null = null;
    let invitedBy: string | null = null;
    let organizationId: string | null = null;

    // If registering via invitation: use invitation's email, role and organization_id
    if (data.invitation_token) {
      const invitation = await this.fastify.db('invitation')
        .where({ token: data.invitation_token, status: 'pending' })
        .first();
      if (!invitation) {
        throw Object.assign(new Error('Invalid or expired invitation'), { statusCode: 400 });
      }
      if (new Date(invitation.expires_at) < new Date()) {
        throw Object.assign(new Error('Invitation expired'), { statusCode: 400 });
      }
      finalEmail = invitation.email;
      finalRole = invitation.role;
      invitationId = invitation.id;
      invitedBy = invitation.invited_by;
      organizationId = invitation.organization_id;

      // Un invité (admin ou prestataire) rejoint l'org de l'inviteur → company = org name.
      const org = await this.fastify.db('organization').where({ id: organizationId }).first();
      finalCompanyName = org?.name ?? finalCompanyName;
    }

    const existing = await this.userService.findByEmail(finalEmail);
    if (existing) {
      throw Object.assign(new Error('Email already in use'), { statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // If no invitation, create a new organization for this user (they become admin of it)
    if (!organizationId) {
      const orgName = data.company_name || `${data.first_name} ${data.last_name}`;
      const orgPayload: Record<string, unknown> = { name: orgName };
      if (data.organization) {
        for (const [key, value] of Object.entries(data.organization)) {
          if (value === undefined) continue;
          orgPayload[key] = value;
        }
      }
      const [org] = await this.fastify.db('organization')
        .insert(orgPayload)
        .returning('id');
      organizationId = org.id;
      // New standalone accounts are always admins of their own organization
      finalRole = 'admin';
      finalCompanyName = orgName;
    }

    const user = await this.userService.create({
      email: finalEmail,
      password_hash: passwordHash,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      role: finalRole, // legacy column — sera retire en migration B
      company_name: finalCompanyName,
      organization_id: organizationId, // legacy column — sera retire en migration B
      active_organization_id: organizationId,
    } as Partial<UserRow>);

    // Cree la membership dans la nouvelle table organization_member.
    await this.fastify.db('organization_member')
      .insert({ organization_id: organizationId, user_id: user.id, role: finalRole })
      .onConflict(['organization_id', 'user_id'])
      .ignore();

    // Set the organization's created_by to the first admin if not set
    await this.fastify.db('organization')
      .where({ id: organizationId })
      .whereNull('created_by')
      .update({ created_by: user.id });

    // Mark invitation as accepted if applicable
    if (invitationId) {
      await this.fastify.db('invitation').where({ id: invitationId }).update({ status: 'accepted' });
      // Prévenir l'inviteur que la personne a rejoint l'organisation.
      if (invitedBy) {
        const { notifyInvitationAccepted } = await import('@/lib/push');
        notifyInvitationAccepted(
          this.fastify.db,
          invitedBy,
          `${data.first_name} ${data.last_name}`.trim(),
          finalCompanyName || "l'organisation",
        ).catch((err) => this.fastify.log.error({ err }, 'push invitation accepted failed'));
      }
    }

    const tokens = await this.generateTokens(user, data.platform ?? 'web');
    const { password_hash: _, ...safeUser } = user;

    return { user: safeUser, ...tokens };
  }

  async updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401 });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userService.update(userId, { password_hash: newHash } as Partial<UserRow>);

    // Revoke all refresh tokens to force re-login on other devices
    await this.fastify.db('refresh_token').where({ user_id: userId }).del();

    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.userService.findByEmail(email);
    // Always return success to avoid email enumeration
    if (!user || !user.is_active) {
      return { message: 'If an account exists with this email, a reset link has been sent.' };
    }

    // Generate a reset token: userId + expiry, signed with JWT_SECRET
    const expires = Date.now() + 30 * 60 * 1000; // 30 minutes
    const data = `${user.id}:${expires}`;
    const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
    const token = Buffer.from(JSON.stringify({ u: user.id, e: expires, s: signature })).toString('base64url');

    // Lien web public (page pont) qui ouvre l'app via deep link estia-clean-connect://
    const resetLink = `${env.APP_URL}/reset-password/${token}`;
    const { sendMail, buildBrandedEmail } = await import('@/lib/mailer');

    await sendMail({
      to: email,
      subject: 'Estia Clean Connect — Réinitialisation de votre mot de passe',
      html: buildBrandedEmail({
        heading: 'Réinitialisation du mot de passe',
        bodyHtml: `
          <p style="color: #475569; line-height: 1.6; margin: 0;">
            Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
          </p>`,
        ctaLabel: 'Réinitialiser mon mot de passe',
        ctaUrl: resetLink,
        footnoteHtml: `
          Ce lien expire dans 30 minutes.<br>
          Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.`,
      }),
    });

    return { message: 'If an account exists with this email, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    let decoded: { u: string; e: number; s: string };
    try {
      decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch {
      throw Object.assign(new Error('Invalid reset token'), { statusCode: 400 });
    }

    if (decoded.e < Date.now()) {
      throw Object.assign(new Error('Reset token has expired'), { statusCode: 400 });
    }

    const expected = createHmac('sha256', env.JWT_SECRET).update(`${decoded.u}:${decoded.e}`).digest('hex');
    if (decoded.s !== expected) {
      throw Object.assign(new Error('Invalid reset token'), { statusCode: 400 });
    }

    const user = await this.userService.findById(decoded.u);
    if (!user) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userService.update(user.id, { password_hash: newHash } as Partial<UserRow>);

    // Revoke all refresh tokens
    await this.fastify.db('refresh_token').where({ user_id: user.id }).del();

    return { message: 'Password has been reset successfully' };
  }

  async login(email: string, password: string, platform: 'mobile' | 'web' = 'web') {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.is_active) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }

    const tokens = await this.generateTokens(user, platform);
    const { password_hash: _, ...safeUser } = user;

    return { user: safeUser, ...tokens };
  }

  async refresh(refreshToken: string) {
    const stored = (await this.fastify.db('refresh_token').where({ token: refreshToken }).first()) as
      | { id: string; user_id: string; platform: 'mobile' | 'web' | null }
      | undefined;
    if (!stored) {
      throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
    }

    // Delete old token (rotation) — sa plateforme est conservée pour le nouveau.
    await this.fastify.db('refresh_token').where({ id: stored.id }).del();

    const user = await this.userService.findById(stored.user_id);
    if (!user || !user.is_active) {
      throw Object.assign(new Error('User not found or inactive'), { statusCode: 401 });
    }

    return this.generateTokens(user, stored.platform ?? 'web');
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      // Logout du device courant uniquement : on retrouve le refresh token,
      // on en lit la plateforme, et on nettoie sa session côté user.
      const row = (await this.fastify.db('refresh_token')
        .where({ user_id: userId, token: refreshToken })
        .first()) as { platform: 'mobile' | 'web' | null } | undefined;
      await this.fastify.db('refresh_token')
        .where({ user_id: userId, token: refreshToken })
        .del();
      if (row?.platform === 'mobile') {
        await this.fastify.db('user').where({ id: userId }).update({ current_mobile_session_id: null });
      } else if (row?.platform === 'web') {
        await this.fastify.db('user').where({ id: userId }).update({ current_web_session_id: null });
      }
      invalidateSessionCache(userId);
    } else {
      // Pas de refresh_token fourni → logout total (toutes plateformes).
      await this.fastify.db('refresh_token').where({ user_id: userId }).del();
      await this.fastify.db('user').where({ id: userId }).update({
        current_mobile_session_id: null,
        current_web_session_id: null,
      });
      invalidateSessionCache(userId);
    }
  }

  private async generateTokens(user: UserRow, platform: 'mobile' | 'web' = 'web') {
    const jti = randomUUID();

    // Sessions par plateforme : une nouvelle connexion mobile écrase
    // l'ancienne session mobile (et purge ses refresh tokens), mais ne touche
    // pas la session web — et inversement.
    const sessionCol = platform === 'mobile' ? 'current_mobile_session_id' : 'current_web_session_id';
    await this.fastify.db('user').where({ id: user.id }).update({ [sessionCol]: jti });
    await this.fastify.db('refresh_token').where({ user_id: user.id, platform }).del();
    invalidateSessionCache(user.id);

    const accessToken = this.fastify.jwt.sign(
      { sub: user.id, email: user.email, jti, platform },
      { expiresIn: env.JWT_ACCESS_EXPIRES },
    );

    const refreshToken = randomUUID();
    await this.fastify.db('refresh_token').insert({
      user_id: user.id,
      token: refreshToken,
      platform,
    });

    return { access_token: accessToken, refresh_token: refreshToken };
  }
}

export default AuthService;
