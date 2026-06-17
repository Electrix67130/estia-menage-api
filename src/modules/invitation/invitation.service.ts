import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import BaseService from '@/lib/base-service';
import { InvitationRow, CreateInvitation } from './invitation.schema';
import { sendMail, buildInvitationEmail } from '@/lib/mailer';

const EXPIRES_IN_DAYS = 7;

class InvitationService extends BaseService<InvitationRow> {
  constructor(db: Knex) {
    super(db, 'invitation');
  }

  /** Create a new invitation with a unique token and send email */
  async invite(data: CreateInvitation, invitedBy: string): Promise<InvitationRow> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPIRES_IN_DAYS);

    // Copy the inviter's ACTIVE organization_id so the invited user joins the right org
    const inviter = await this.db('user').where({ id: invitedBy }).first();
    if (!inviter?.active_organization_id) {
      throw Object.assign(new Error('Inviter has no active organization'), { statusCode: 400 });
    }
    const organizationId = inviter.active_organization_id;

    // Refuse d'inviter un email qui est déjà membre de l'organisation.
    const existingUser = await this.db('user')
      .whereRaw('lower(email) = lower(?)', [data.email])
      .first();
    if (existingUser) {
      const alreadyMember = await this.db('organization_member')
        .where({ user_id: existingUser.id, organization_id: organizationId })
        .first();
      if (alreadyMember) {
        throw Object.assign(
          new Error('Cet utilisateur est déjà membre de votre organisation'),
          { statusCode: 409 },
        );
      }
    }

    // Anti-doublon élargi : réutilise une invitation `pending` OU `expired` pour
    // ce couple (email, organisation) — et supprime les éventuels doublons — au
    // lieu d'en créer une nouvelle. (Une invitation `accepted` n'est jamais
    // réutilisée : la personne a déjà rejoint l'org.)
    const reusable = (await this.db('invitation')
      .where({ organization_id: organizationId })
      .whereRaw('lower(email) = lower(?)', [data.email])
      .whereIn('status', ['pending', 'expired'])
      .orderBy('created_at', 'desc')) as InvitationRow[];

    let invitation: InvitationRow;
    if (reusable.length > 0) {
      const keep = reusable[0];
      const extra = reusable.slice(1).map((r) => r.id);
      if (extra.length) await this.db('invitation').whereIn('id', extra).del();
      const [updated] = (await this.db('invitation')
        .where({ id: keep.id })
        .update({
          invited_by: invitedBy,
          role: data.role,
          token: randomUUID(),
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .returning('*')) as InvitationRow[];
      invitation = updated;
    } else {
      invitation = await this.create({
        email: data.email,
        invited_by: invitedBy,
        role: data.role,
        token: randomUUID(),
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        organization_id: organizationId,
      } as Partial<InvitationRow>);
    }

    // Build inviter name for the email (reuse earlier fetched row)
    const inviterName = `${inviter.first_name} ${inviter.last_name}`;

    // Send invitation email
    const { subject, html } = buildInvitationEmail({
      inviterName,
      email: data.email,
      role: data.role || 'prestataire',
      token: invitation.token,
      expiresAt: invitation.expires_at,
    });

    await sendMail({ to: data.email, subject, html });

    return invitation;
  }

  /**
   * Assainit les invitations orphelines : marque `accepted` celles restées
   * `pending`/`expired` dont l'email a déjà rejoint l'organisation (la personne
   * est devenue membre autrement que par cette invitation).
   */
  async reconcileAccepted(organizationId: string): Promise<void> {
    const memberEmails = new Set(
      ((await this.db('organization_member')
        .join('user', 'user.id', 'organization_member.user_id')
        .where('organization_member.organization_id', organizationId)
        .pluck('user.email')) as string[]).map((e) => e.toLowerCase()),
    );
    if (memberEmails.size === 0) return;
    const orphans = (await this.db('invitation')
      .where({ organization_id: organizationId })
      .whereIn('status', ['pending', 'expired'])
      .select('id', 'email')) as { id: string; email: string }[];
    const toAccept = orphans
      .filter((o) => memberEmails.has(o.email.toLowerCase()))
      .map((o) => o.id);
    if (toAccept.length === 0) return;
    await this.db('invitation').whereIn('id', toAccept).update({ status: 'accepted' });
  }

  /** Renvoie une invitation existante : rafraîchit l'expiration (+7j), repasse en
   * pending si besoin, et renvoie l'email avec le token existant. */
  async resend(id: string): Promise<InvitationRow | undefined> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPIRES_IN_DAYS);
    const [updated] = (await this.db(this.table)
      .where({ id })
      .update({ expires_at: expiresAt.toISOString(), status: 'pending' })
      .returning('*')) as InvitationRow[];
    if (!updated) return undefined;

    const inviter = await this.db('user').where({ id: updated.invited_by }).first();
    const inviterName = inviter
      ? `${inviter.first_name} ${inviter.last_name}`.trim()
      : 'Estia Clean Connect';
    const { subject, html } = buildInvitationEmail({
      inviterName,
      email: updated.email,
      role: updated.role || 'prestataire',
      token: updated.token,
      expiresAt: updated.expires_at,
    });
    await sendMail({ to: updated.email, subject, html });
    return updated;
  }

  /** Find a pending invitation by token */
  async findByToken(token: string): Promise<InvitationRow | undefined> {
    return this.findOne({ token, status: 'pending' } as Partial<InvitationRow>);
  }

  /** Accept an invitation */
  async accept(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .update({ status: 'accepted' })
      .returning('*');
    return row as InvitationRow | undefined;
  }

  /** Expire old invitations */
  async expireOld(): Promise<number> {
    return this.db(this.table)
      .where('status', 'pending')
      .where('expires_at', '<', this.db.fn.now())
      .update({ status: 'expired' });
  }
}

export default InvitationService;
