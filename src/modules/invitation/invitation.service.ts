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

    const invitation = await this.create({
      email: data.email,
      invited_by: invitedBy,
      role: data.role,
      token: randomUUID(),
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      organization_id: inviter.active_organization_id,
    } as Partial<InvitationRow>);

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
