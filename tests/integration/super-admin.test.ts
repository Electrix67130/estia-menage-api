import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createSuperAdmin,
  createUser,
  login,
  TEST_PASSWORD,
} from '../helpers/factories';

// Pas de `await` au niveau du module : le projet compile en CommonJS, et
// `tsc --noEmit` (joué par la CI) le refuse. L'app est donc montée dans un
// hook, une fois pour tout le fichier.
let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

describe('garde /super-admin', () => {
  it('ferme la porte à un admin ordinaire', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: auth(admin.token) });
    expect(res.statusCode).toBe(403);
  });

  it('exige une authentification', async () => {
    expect((await app.inject({ method: 'GET', url: '/super-admin/overview' })).statusCode).toBe(401);
  });

  it("laisse entrer le porteur du drapeau", async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const res = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: auth(root.token) });
    expect(res.statusCode).toBe(200);
  });
});

describe('vue d’ensemble', () => {
  it('compte les organisations, les comptes et les ménages', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await createMenage(app, { logementId, organizationId, createdBy: admin.id });

    const res = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: auth(root.token) });
    const body = res.json();
    expect(body.orgs.total).toBe(1);
    expect(body.users.total).toBe(2);
    expect(body.menages.active).toBe(1);
    expect(body.billing.billable_seats).toBe(2);
  });
});

describe('organisations', () => {
  it('liste les orgs avec leurs compteurs — la colonne de rétention comprise', async () => {
    // Régression : `archive_retention_years` était déclarée dans le schéma mais
    // aucune migration ne l'avait créée, la console tombait en 500.
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await createMenage(app, { logementId, organizationId, createdBy: admin.id });

    const res = await app.inject({ method: 'GET', url: '/super-admin/orgs?page=1', headers: auth(root.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({
      name: 'Conciergerie',
      member_count: 2,
      menage_count: 1,
      archive_retention_years: 5,
    });
  });

  it('le kill switch coupe réellement l’accès aux données', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const autre = await createOrgWithAdmin(app, 'Conciergerie B');

    expect((await app.inject({ method: 'GET', url: '/menages', headers: auth(autre.admin.token) })).statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/super-admin/orgs/${autre.organizationId}/disable`,
      headers: auth(root.token),
    });

    // Sans membership active, plus aucune route métier ne répond : c'est ce qui
    // rend le bouton autre chose qu'un drapeau décoratif.
    const apres = await app.inject({ method: 'GET', url: '/menages', headers: auth(autre.admin.token) });
    expect(apres.statusCode).toBe(403);

    await app.inject({
      method: 'POST',
      url: `/super-admin/orgs/${autre.organizationId}/enable`,
      headers: auth(root.token),
    });
    const reactive = await app.inject({ method: 'GET', url: '/menages', headers: auth(autre.admin.token) });
    expect(reactive.statusCode).toBe(200);
    expect(admin.id).toBeDefined();
  });

  it('trace chaque bascule dans le journal d’audit', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    await app.inject({
      method: 'POST',
      url: `/super-admin/orgs/${organizationId}/disable`,
      headers: auth(root.token),
    });

    const trace = await app.db('audit_log').where({ action: 'org.disable' }).first();
    expect(trace).toMatchObject({ super_admin_id: root.id, target_type: 'organization', target_id: organizationId });
  });

  it('délivre un jeton d’usurpation au nom d’un admin de l’org', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const cible = await createOrgWithAdmin(app, 'Conciergerie B');

    const res = await app.inject({
      method: 'POST',
      url: `/super-admin/orgs/${cible.organizationId}/impersonate`,
      headers: auth(root.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user_id).toBe(cible.admin.id);

    // Le jeton doit réellement ouvrir la session de la cible.
    const enTantQue = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: auth(res.json().access_token),
    });
    expect(enTantQue.json().id ?? enTantQue.json().user?.id).toBe(cible.admin.id);
  });
});

describe('comptes', () => {
  it('désactiver un compte le déconnecte et lui ferme le login', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    await app.inject({
      method: 'POST',
      url: `/super-admin/users/${presta.id}/disable`,
      headers: auth(root.token),
    });

    // Les sessions sont supprimées : désactiver sans couper ne désactive rien.
    const sessions = await app.db('refresh_token').where({ user_id: presta.id });
    expect(sessions).toHaveLength(0);

    const relogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: presta.email, password: TEST_PASSWORD, platform: 'web' },
    });
    expect(relogin.statusCode).toBe(401);
  });

  it('coupe les sessions sans toucher au compte', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    const res = await app.inject({
      method: 'POST',
      url: `/super-admin/users/${presta.id}/kick-sessions`,
      headers: auth(root.token),
    });
    expect(res.json().sessions_killed).toBeGreaterThan(0);
    // Le compte reste actif : il peut se reconnecter.
    await expect(login(app, presta.email)).resolves.toBeTypeOf('string');
  });

  it('génère un mot de passe temporaire qui fonctionne', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    const res = await app.inject({
      method: 'POST',
      url: `/super-admin/users/${presta.id}/force-reset`,
      headers: auth(root.token),
    });
    const temporaire = res.json().temporary_password;
    expect(temporaire).toMatch(/^Tmp-/);

    const avecAncien = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: presta.email, password: TEST_PASSWORD, platform: 'web' },
    });
    expect(avecAncien.statusCode).toBe(401);

    const avecNouveau = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: presta.email, password: temporaire, platform: 'web' },
    });
    expect(avecNouveau.statusCode).toBe(200);
  });

  it('refuse de se supprimer soi-même', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);
    const res = await app.inject({
      method: 'DELETE',
      url: `/super-admin/users/${root.id}`,
      headers: auth(root.token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('journaux', () => {
  it('expose le journal d’audit et le journal d’erreurs', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const root = await createSuperAdmin(app, organizationId);

    const audit = await app.inject({ method: 'GET', url: '/super-admin/audit', headers: auth(root.token) });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toHaveProperty('meta.total');

    const erreurs = await app.inject({ method: 'GET', url: '/super-admin/errors', headers: auth(root.token) });
    expect(erreurs.statusCode).toBe(200);
    expect(erreurs.json()).toHaveProperty('meta.total');
  });
});
