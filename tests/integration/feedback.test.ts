import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createSuperAdmin, createUser } from '../helpers/factories';

// Pas de `await` au niveau du module : le projet compile en CommonJS, et
// `tsc --noEmit` (joué par la CI) le refuse. L'app est donc montée dans un
// hook, une fois pour tout le fichier.
let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

const signalement = {
  type: 'bug',
  subject: 'Les photos ne partent pas',
  message: 'Depuis la mise à jour, la galerie reste vide après un envoi.',
  platform: 'mobile',
  app_version: '0.1.0',
  screen: '/menage/[id]',
  locale: 'fr',
};

describe('POST /feedbacks', () => {
  it('enregistre le signalement d’un prestataire avec son contexte technique', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    const res = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(presta.token),
      payload: signalement,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'bug',
      status: 'new',
      platform: 'mobile',
      app_version: '0.1.0',
      user_id: presta.id,
      organization_id: organizationId,
    });
  });

  it('refuse un message trop court', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(admin.token),
      payload: { ...signalement, message: 'ko' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('exige une authentification', async () => {
    const res = await app.inject({ method: 'POST', url: '/feedbacks', payload: signalement });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /feedbacks/mine', () => {
  it('ne renvoie que ses propres signalements', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const a = await createUser(app, { organizationId, role: 'prestataire' });
    const b = await createUser(app, { organizationId, role: 'prestataire' });

    await app.inject({ method: 'POST', url: '/feedbacks', headers: auth(a.token), payload: signalement });
    await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(b.token),
      payload: { ...signalement, subject: 'Autre chose' },
    });

    const res = await app.inject({ method: 'GET', url: '/feedbacks/mine', headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data).toHaveLength(1);
    expect(data[0].subject).toBe(signalement.subject);
  });

  it('traite le signalement d’autrui comme inexistant', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const auteur = await createUser(app, { organizationId, role: 'prestataire' });
    const autre = await createUser(app, { organizationId, role: 'prestataire' });

    const cree = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(auteur.token),
      payload: signalement,
    });
    const id = cree.json().id;

    // 404 et non 403 : un 403 confirmerait que ce signalement existe.
    const res = await app.inject({ method: 'GET', url: `/feedbacks/mine/${id}`, headers: auth(autre.token) });
    expect(res.statusCode).toBe(404);
  });
});

describe('console d’organisation', () => {
  it('liste les signalements de son org avec les compteurs par statut', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    await app.inject({ method: 'POST', url: '/feedbacks', headers: auth(presta.token), payload: signalement });

    const res = await app.inject({ method: 'GET', url: '/feedbacks', headers: auth(admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().counts).toMatchObject({ new: 1 });
  });

  it('est fermée aux prestataires', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({ method: 'GET', url: '/feedbacks', headers: auth(presta.token) });
    expect(res.statusCode).toBe(403);
  });

  it('ne montre pas les signalements d’une autre organisation', async () => {
    const une = await createOrgWithAdmin(app, 'Conciergerie A');
    const autre = await createOrgWithAdmin(app, 'Conciergerie B');
    await app.inject({ method: 'POST', url: '/feedbacks', headers: auth(autre.admin.token), payload: signalement });

    const res = await app.inject({ method: 'GET', url: '/feedbacks', headers: auth(une.admin.token) });
    expect(res.json().data).toHaveLength(0);
  });

  it('répondre marque le signalement traité et le rend visible à l’auteur', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const cree = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(presta.token),
      payload: signalement,
    });
    const id = cree.json().id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${id}`,
      headers: auth(admin.token),
      payload: { response: 'Corrigé dans la version 0.1.1, merci.' },
    });

    expect(patch.statusCode).toBe(200);
    // Répondre, c'est traiter : le statut suit sans qu'on ait à le préciser.
    expect(patch.json()).toMatchObject({ status: 'resolved', responded_by: admin.id });

    const mine = await app.inject({ method: 'GET', url: '/feedbacks/mine', headers: auth(presta.token) });
    expect(mine.json().data[0].response).toBe('Corrigé dans la version 0.1.1, merci.');
  });

  it('permet de changer le statut sans répondre', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const cree = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(presta.token),
      payload: signalement,
    });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${cree.json().id}`,
      headers: auth(admin.token),
      payload: { status: 'in_progress' },
    });
    expect(patch.json()).toMatchObject({ status: 'in_progress', response: null });
  });

  it('refuse à un admin de traiter le signalement d’une autre organisation', async () => {
    const une = await createOrgWithAdmin(app, 'Conciergerie A');
    const autre = await createOrgWithAdmin(app, 'Conciergerie B');
    const cree = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(autre.admin.token),
      payload: signalement,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${cree.json().id}`,
      headers: auth(une.admin.token),
      payload: { status: 'declined' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('console super admin', () => {
  it('voit les signalements de toutes les organisations', async () => {
    const une = await createOrgWithAdmin(app, 'Conciergerie A');
    const autre = await createOrgWithAdmin(app, 'Conciergerie B');
    const root = await createSuperAdmin(app, une.organizationId);

    await app.inject({ method: 'POST', url: '/feedbacks', headers: auth(une.admin.token), payload: signalement });
    await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(autre.admin.token),
      payload: { ...signalement, subject: 'Autre org' },
    });

    const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(root.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    expect(res.json().data.map((f: { organization_name: string }) => f.organization_name).sort()).toEqual([
      'Conciergerie A',
      'Conciergerie B',
    ]);
  });

  it('est fermée à un admin ordinaire', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(admin.token) });
    expect(res.statusCode).toBe(403);
  });

  it('trace la réponse dans le journal d’audit', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const cree = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(admin.token),
      payload: signalement,
    });

    await app.inject({
      method: 'PATCH',
      url: `/super-admin/feedbacks/${cree.json().id}`,
      headers: auth(root.token),
      payload: { response: 'On regarde.' },
    });

    const audit = await app.db('audit_log').where({ action: 'feedback.respond' }).first();
    expect(audit).toMatchObject({ super_admin_id: root.id, target_type: 'feedback' });
  });
});
