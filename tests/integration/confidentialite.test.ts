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

// Pas de `await` au niveau du module : le projet compile en CommonJS, et
// `tsc --noEmit` (joué par la CI) le refuse. L'app est donc montée dans un
// hook, une fois pour tout le fichier.
let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

async function createClient(organizationId: string, createdBy: string, nom = 'Client Test') {
  const [row] = await app
    .db('client')
    .insert({ organization_id: organizationId, created_by: createdBy, company_name: nom })
    .returning('id');
  return row.id as string;
}

describe('fichier client', () => {
  it("l'annuaire complet est réservé à l'admin", async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    await createClient(organizationId, admin.id);

    expect((await app.inject({ method: 'GET', url: '/clients', headers: auth(admin.token) })).statusCode).toBe(200);
    // Un prestataire n'a rien à faire dans le fichier client.
    expect((await app.inject({ method: 'GET', url: '/clients', headers: auth(presta.token) })).statusCode).toBe(403);
  });

  it('une fiche client reste invisible à un prestataire sans la permission', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const clientId = await createClient(organizationId, admin.id);
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await app.db('logement').where({ id: logementId }).update({ client_id: clientId });
    // Membre du logement, mais can_view_clients à false : le défaut du rôle.
    await addLogementMember(app, { logementId, userId: presta.id, canViewClients: false });

    const res = await app.inject({ method: 'GET', url: `/clients/${clientId}`, headers: auth(presta.token) });
    expect(res.statusCode).toBe(404);
  });

  it('la fiche s’ouvre au membre à qui l’admin a donné la permission', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const clientId = await createClient(organizationId, admin.id);
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await app.db('logement').where({ id: logementId }).update({ client_id: clientId });
    await addLogementMember(app, { logementId, userId: presta.id, canViewClients: true });

    const res = await app.inject({ method: 'GET', url: `/clients/${clientId}`, headers: auth(presta.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().company_name).toBe('Client Test');
  });
});

describe('codes d’accès', () => {
  it('sont lisibles par un prestataire affecté, même non membre du logement', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const remplacant = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await app.db('logement_code').insert({ logement_id: logementId, label: 'Portail', code: 'A12B' });
    // Affecté à une seule prestation, sans être membre permanent : sans le code
    // il ne peut pas entrer.
    await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: remplacant.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/logement-codes?logement_id=${logementId}`,
      headers: auth(remplacant.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ label: 'Portail', code: 'A12B' });
  });

  it('restent invisibles à un prestataire étranger au logement', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const etranger = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await app.db('logement_code').insert({ logement_id: logementId, label: 'Portail', code: 'A12B' });

    const res = await app.inject({
      method: 'GET',
      url: `/logement-codes?logement_id=${logementId}`,
      headers: auth(etranger.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('ne sont modifiables que par un admin', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });

    const refus = await app.inject({
      method: 'POST',
      url: '/logement-codes',
      headers: auth(presta.token),
      payload: { logement_id: logementId, label: 'Portail', code: 'A12B' },
    });
    expect(refus.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/logement-codes',
      headers: auth(admin.token),
      payload: { logement_id: logementId, label: 'Portail', code: 'A12B' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('le premier code alimente le champ legacy key_safe_code', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });

    await app.inject({
      method: 'POST',
      url: '/logement-codes',
      headers: auth(admin.token),
      payload: { logement_id: logementId, label: 'Boîte à clés', code: '1984' },
    });

    // Le détail ménage expose encore ce champ par jointure, et les anciens
    // clients le lisent : il doit rester le miroir du premier code.
    const logement = await app.db('logement').where({ id: logementId }).first();
    expect(logement.key_safe_code).toBe('1984');
  });
});

describe('visibilité des prestations', () => {
  it("un ménage affecté disparaît de la liste des autres prestataires", async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const titulaire = await createUser(app, { organizationId, role: 'prestataire' });
    const collegue = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: titulaire.id });
    await addLogementMember(app, { logementId, userId: collegue.id });

    await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: titulaire.id,
    });

    const vueTitulaire = await app.inject({ method: 'GET', url: '/menages', headers: auth(titulaire.token) });
    expect(vueTitulaire.json().data).toHaveLength(1);

    const vueCollegue = await app.inject({ method: 'GET', url: '/menages', headers: auth(collegue.token) });
    expect(vueCollegue.json().data).toHaveLength(0);
  });

  it('un ménage non assigné reste visible : il est à prendre', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: presta.id });
    await createMenage(app, { logementId, organizationId, createdBy: admin.id });

    const res = await app.inject({ method: 'GET', url: '/menages', headers: auth(presta.token) });
    expect(res.json().data).toHaveLength(1);
  });

  it('assigned=me ne renvoie que ce que le prestataire a fait', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: presta.id });

    await createMenage(app, { logementId, organizationId, createdBy: admin.id, prestataireUserId: presta.id });
    await createMenage(app, { logementId, organizationId, createdBy: admin.id }); // non assigné

    const tout = await app.inject({ method: 'GET', url: '/menages', headers: auth(presta.token) });
    expect(tout.json().data).toHaveLength(2);

    // L'historique : uniquement les prestations réellement exécutées.
    const sien = await app.inject({ method: 'GET', url: '/menages?assigned=me', headers: auth(presta.token) });
    expect(sien.json().data).toHaveLength(1);
  });
});
