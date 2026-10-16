import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createLogement, createMenage, createOrgWithAdmin, createUser } from '../helpers/factories';
import { laisserPartirLesPush } from '../helpers/push';

/** Chaque bug ou suggestion envoyé depuis les apps prévient la boîte support. */

const { mails, panne } = vi.hoisted(() => ({
  mails: [] as { to: string; subject: string; html: string }[],
  panne: { active: false },
}));
vi.mock('@/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mailer')>();
  return {
    ...actual,
    sendMail: vi.fn(async (opts: { to: string; subject: string; html: string }) => {
      if (panne.active) throw new Error('SMTP indisponible');
      mails.push(opts);
    }),
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

beforeEach(async () => {
  await truncateAll(app.db);
  mails.length = 0;
  panne.active = false;
});

const deposer = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/feedbacks', headers: auth(token), payload });

describe('mail à la boîte support', () => {
  it('un bug part vers contact@estiaconciergerie.fr avec l’auteur, l’organisation et le contexte', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie Azur');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });

    const res = await deposer(marie.token, {
      type: 'bug',
      subject: 'Le pointage plante',
      message: 'Quand je pointe mon départ, l’app se ferme.',
      platform: 'mobile',
      app_version: '1.0.0 (22)',
      screen: 'menage/[id]',
      locale: 'fr',
    });
    expect(res.statusCode).toBe(201);

    await laisserPartirLesPush();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'contact@estiaconciergerie.fr', subject: '[Bug] Le pointage plante' });
    expect(mails[0].html).toContain(marie.email);
    expect(mails[0].html).toContain('Conciergerie Azur');
    expect(mails[0].html).toContain('Quand je pointe mon départ');
    expect(mails[0].html).toContain('1.0.0 (22)');
  });

  it('une suggestion aussi ; le texte de l’utilisateur est échappé', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });

    await deposer(marie.token, {
      type: 'suggestion',
      subject: 'Un mode sombre',
      message: 'Ce serait bien <script>alert(1)</script> le soir.',
    });

    await laisserPartirLesPush();
    expect(mails[0].subject).toBe('[Suggestion] Un mode sombre');
    expect(mails[0].html).not.toContain('<script>');
    expect(mails[0].html).toContain('&lt;script&gt;');
  });

  it('un contenu signalé ne passe pas par ce mail (il a sa propre page et sa push)', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const sofia = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, prestataireUserId: marie.id });
    const [comment] = await app
      .db('comment')
      .insert({ menage_id: menageId, author_id: sofia.id, content: 'Propos déplacés' })
      .returning('id');

    await deposer(marie.token, {
      type: 'report',
      subject: 'Commentaire',
      message: 'Ce commentaire est déplacé envers un collègue.',
      target_type: 'comment',
      target_id: comment.id,
    });

    await laisserPartirLesPush();
    expect(mails).toHaveLength(0);
  });

  it('un SMTP en panne ne fait pas échouer l’envoi du signalement', async () => {
    panne.active = true;
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });

    const res = await deposer(marie.token, { type: 'bug', subject: 'Écran blanc', message: 'L’accueil reste blanc au lancement.' });
    expect(res.statusCode).toBe(201);
    expect(await app.db('feedback').where({ id: res.json().id }).first()).toBeTruthy();
  });
});
