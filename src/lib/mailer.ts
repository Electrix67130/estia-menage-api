import nodemailer from 'nodemailer';
import env from '@/config/env';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    })
  : null;

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: SendMailOptions): Promise<void> {
  if (!transporter) {
    console.log(`[MAIL] SMTP non configuré — mail non envoyé à ${to}`);
    console.log(`[MAIL] Sujet: ${subject}`);
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
  });
}

const BRAND = '#2563EB';

/** Coquille HTML commune a tous les emails transactionnels (logo + branding Estia Clean Connect). */
export function buildBrandedEmail(params: {
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footnoteHtml?: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #F7FAFC;">
      <div style="text-align: center; margin-bottom: 28px;">
        <img src="${env.APP_URL}/assets/logo-estia.png?v=3" alt="Estia Clean Connect" height="72" style="height: 72px; width: auto;">
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 28px;">
        <h2 style="color: #0F172A; margin-top: 0;">${params.heading}</h2>
        ${params.bodyHtml}

        <div style="text-align: center; margin: 28px 0 8px;">
          <a href="${params.ctaUrl}"
             style="display: inline-block; background: ${BRAND}; color: #FFFFFF; text-decoration: none;
                    padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">
            ${params.ctaLabel}
          </a>
        </div>

        ${params.footnoteHtml ? `<p style="color: #94A3B8; font-size: 13px; line-height: 1.6;">${params.footnoteHtml}</p>` : ''}
      </div>

      <p style="color: #94A3B8; font-size: 12px; text-align: center; margin-top: 24px;">
        Estia Clean Connect — Gestion de prestations de menage
      </p>
    </div>
  `;
}

export function buildInvitationEmail(params: {
  inviterName: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
}): { subject: string; html: string } {
  // Lien web public (page pont) qui ouvre l'app via deep link estia-clean-connect://
  const webLink = `${env.APP_URL}/invite/${params.token}`;
  const expiresFormatted = new Date(params.expiresAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const roleLabels: Record<string, string> = {
    admin: 'Administrateur',
    prestataire: 'Prestataire',
    client: 'Client',
  };

  return {
    subject: `${params.inviterName} vous invite à rejoindre Estia Clean Connect`,
    html: buildBrandedEmail({
      heading: 'Vous êtes invité !',
      bodyHtml: `
        <p style="color: #475569; line-height: 1.6; margin: 0;">
          <strong>${params.inviterName}</strong> vous invite à rejoindre <strong>Estia Clean Connect</strong>
          en tant que <strong>${roleLabels[params.role] || params.role}</strong>.
        </p>`,
      ctaLabel: "Accepter l'invitation",
      ctaUrl: webLink,
      footnoteHtml: `
        Cette invitation expire le ${expiresFormatted}.<br>
        Ou copiez ce lien dans votre navigateur :<br>
        <a href="${webLink}" style="color: ${BRAND};">${webLink}</a>`,
    }),
  };
}

/** Échappe un texte saisi par un utilisateur avant de l'insérer dans un e-mail HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Nouveau bug ou nouvelle suggestion → boîte support. Sans ce mail, rien ne
 * prévenait de leur arrivée : il fallait aller voir la console.
 */
export function buildFeedbackNotificationEmail(params: {
  type: 'bug' | 'suggestion';
  subject: string;
  message: string;
  authorName: string;
  authorEmail: string;
  organizationName: string | null;
  platform: string | null;
  appVersion: string | null;
  screen: string | null;
  locale: string | null;
}): { subject: string; html: string } {
  const label = params.type === 'bug' ? 'Bug' : 'Suggestion';
  const context = [
    params.platform ? `Plateforme : ${escapeHtml(params.platform)}` : null,
    params.appVersion ? `Version : ${escapeHtml(params.appVersion)}` : null,
    params.screen ? `Écran : ${escapeHtml(params.screen)}` : null,
    params.locale ? `Langue : ${escapeHtml(params.locale)}` : null,
  ].filter(Boolean);
  const row = (k: string, v: string) =>
    `<tr><td style="color: #64748B; padding: 2px 12px 2px 0; vertical-align: top;">${k}</td><td style="color: #0F172A;">${v}</td></tr>`;

  return {
    subject: `[${label}] ${params.subject}`,
    html: buildBrandedEmail({
      heading: `${label} : ${escapeHtml(params.subject)}`,
      bodyHtml: `
        <table style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          ${row('De', `${escapeHtml(params.authorName)} — <a href="mailto:${escapeHtml(params.authorEmail)}" style="color: ${BRAND};">${escapeHtml(params.authorEmail)}</a>`)}
          ${row('Organisation', escapeHtml(params.organizationName ?? '—'))}
        </table>
        <div style="background: #F8FAFC; border-left: 3px solid ${BRAND}; padding: 12px 16px; color: #0F172A; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(params.message)}</div>`,
      ctaLabel: 'Ouvrir dans la console',
      ctaUrl: `${env.DASHBOARD_URL}/admin/feedback`,
      footnoteHtml: context.length > 0 ? context.join(' · ') : undefined,
    }),
  };
}
