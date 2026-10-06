import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createUser,
} from '../helpers/factories';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

// La confidentialité des fiches (annuaire admin only, `can_view_clients`) est
// couverte dans confidentialite.test.ts ; ici : le cycle de vie et le rapport.

describe('fichier client', () => {
  it('exige au moins un nom, et n’est créé que par un admin', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    const sansNom = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: auth(admin.token),
      payload: { email: 'anonyme@test.local' },
    });
    expect(sansNom.statusCode).toBe(400);

    const parPresta = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: auth(presta.token),
      payload: { company_name: 'SCI Horizon' },
    });
    expect(parPresta.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: auth(admin.token),
      payload: { company_name: 'SCI Horizon', siret: '12345678901234' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ company_name: 'SCI Horizon', country: 'FR', organization_id: organizationId });
  });

  it('la suppression archive la fiche : elle sort de l’annuaire sans disparaître', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const client = (
      await app.inject({
        method: 'POST',
        url: '/clients',
        headers: auth(admin.token),
        payload: { company_name: 'SCI Horizon' },
      })
    ).json();

    const res = await app.inject({ method: 'DELETE', url: `/clients/${client.id}`, headers: auth(admin.token) });
    expect(res.statusCode).toBe(204);
    const liste = await app.inject({ method: 'GET', url: '/clients', headers: auth(admin.token) });
    expect(liste.json().data).toHaveLength(0);
    const row = await app.db('client').where({ id: client.id }).first();
    expect(row.archived_at).not.toBeNull();
  });

  it('la recherche et les modifications restent dans l’organisation', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const creer = (token: string, company_name: string) =>
      app.inject({ method: 'POST', url: '/clients', headers: auth(token), payload: { company_name } });
    const horizon = (await creer(admin.token, 'SCI Horizon')).json();
    await creer(admin.token, 'Famille Dupont');
    await creer(autre.admin.token, 'SCI Horizon Voisine');

    const recherche = await app.inject({ method: 'GET', url: '/clients?search=horizon', headers: auth(admin.token) });
    expect(recherche.json().data.map((c: { id: string }) => c.id)).toEqual([horizon.id]);

    const parVoisine = await app.inject({
      method: 'PATCH',
      url: `/clients/${horizon.id}`,
      headers: auth(autre.admin.token),
      payload: { notes: 'intrusion' },
    });
    expect(parVoisine.statusCode).toBe(404);
  });

  it('liste les logements d’un client à qui a le droit de le voir', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const [client] = await app
      .db('client')
      .insert({ organization_id: organizationId, created_by: admin.id, company_name: 'SCI' })
      .returning('id');
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Villa' });
    await app.db('logement').where({ id: logementId }).update({ client_id: client.id });
    await addLogementMember(app, { logementId, userId: presta.id, canViewClients: false });

    const refus = await app.inject({ method: 'GET', url: `/clients/${client.id}/logements`, headers: auth(presta.token) });
    expect(refus.statusCode).toBe(404);

    const ok = await app.inject({ method: 'GET', url: `/clients/${client.id}/logements`, headers: auth(admin.token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().map((l: { name: string }) => l.name)).toEqual(['Villa']);
  });
});

describe('rapport comptable d’un client', () => {
  it('reprend les prestations de la période, sans les annulées, avec leurs prestataires', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const [client] = await app
      .db('client')
      .insert({ organization_id: organizationId, created_by: admin.id, company_name: 'SCI' })
      .returning('id');
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await app.db('logement').where({ id: logementId }).update({ client_id: client.id });
    const base = { logementId, organizationId, createdBy: admin.id };
    const dans = await createMenage(app, { ...base, datePrevue: '2026-07-10', prestataireUserId: presta.id });
    await createMenage(app, { ...base, datePrevue: '2026-07-20', status: 'annule' });
    await createMenage(app, { ...base, datePrevue: '2026-08-05' }); // hors période

    const res = await app.inject({
      method: 'GET',
      url: `/clients/${client.id}/report?from=2026-07-01&to=2026-07-31`,
      headers: auth(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().period).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(res.json().menages).toHaveLength(1);
    expect(res.json().menages[0].id).toBe(dans);
    expect(res.json().menages[0].prestataires.map((p: { id: string }) => p.id)).toEqual([presta.id]);
  });

  it('est réservé à l’admin et exige des dates bien formées', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const [client] = await app
      .db('client')
      .insert({ organization_id: organizationId, created_by: admin.id, company_name: 'SCI' })
      .returning('id');

    const parPresta = await app.inject({
      method: 'GET',
      url: `/clients/${client.id}/report?from=2026-07-01&to=2026-07-31`,
      headers: auth(presta.token),
    });
    expect(parPresta.statusCode).toBe(403);

    const malForme = await app.inject({
      method: 'GET',
      url: `/clients/${client.id}/report?from=juillet&to=2026-07-31`,
      headers: auth(admin.token),
    });
    expect(malForme.statusCode).toBe(400);
  });
});
