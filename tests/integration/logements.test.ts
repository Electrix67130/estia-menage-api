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
  type TestUser,
} from '../helpers/factories';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

interface Contexte {
  organizationId: string;
  admin: TestUser;
  presta: TestUser;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  return { organizationId, admin, presta };
}

describe('création et modification', () => {
  it('seul un admin crée un logement ; le code boîte à clés alimente la liste des codes', async () => {
    const { admin, presta } = await contexte();
    const refus = await app.inject({
      method: 'POST',
      url: '/logements',
      headers: auth(presta.token),
      payload: { name: 'Villa' },
    });
    expect(refus.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/logements',
      headers: auth(admin.token),
      payload: { name: 'Villa', key_safe_code: '2468', n_lit_double: 2 },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ name: 'Villa', n_lit_double: 2, created_by: admin.id });
    const codes = await app.db('logement_code').where({ logement_id: ok.json().id });
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ code: '2468' });
  });

  it('la modification est réservée à l’admin et ne traverse pas les organisations', async () => {
    const { organizationId, admin, presta } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: presta.id, role: 'manager' });

    const parMembre = await app.inject({
      method: 'PATCH',
      url: `/logements/${logementId}`,
      headers: auth(presta.token),
      payload: { name: 'Renommée' },
    });
    expect(parMembre.statusCode).toBe(403);

    const parVoisine = await app.inject({
      method: 'PATCH',
      url: `/logements/${logementId}`,
      headers: auth(autre.admin.token),
      payload: { name: 'Renommée' },
    });
    expect(parVoisine.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'PATCH',
      url: `/logements/${logementId}`,
      headers: auth(admin.token),
      payload: { name: 'Renommée', color: '#ff0000' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Renommée', color: '#ff0000' });
  });
});

describe('visibilité', () => {
  it('l’admin voit tous les logements, un prestataire seulement ceux dont il est membre', async () => {
    const { organizationId, admin, presta } = await contexte();
    const sien = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Le sien' });
    await createLogement(app, { organizationId, createdBy: admin.id, name: 'Un autre' });
    await addLogementMember(app, { logementId: sien, userId: presta.id });

    const vueAdmin = await app.inject({ method: 'GET', url: '/logements', headers: auth(admin.token) });
    expect(vueAdmin.json().meta.total).toBe(2);

    const vuePresta = await app.inject({ method: 'GET', url: '/logements', headers: auth(presta.token) });
    expect(vuePresta.json().data.map((l: { id: string }) => l.id)).toEqual([sien]);
  });

  it('le détail d’un logement dont on n’est pas membre n’existe pas', async () => {
    const { organizationId, admin, presta } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });

    expect(
      (await app.inject({ method: 'GET', url: `/logements/${logementId}`, headers: auth(presta.token) })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/logements/${logementId}`, headers: auth(autre.admin.token) }))
        .statusCode,
    ).toBe(404);

    await addLogementMember(app, { logementId, userId: presta.id });
    expect(
      (await app.inject({ method: 'GET', url: `/logements/${logementId}`, headers: auth(presta.token) })).statusCode,
    ).toBe(200);
  });

  it('signale le nombre de consommables à racheter', async () => {
    const { organizationId, admin } = await contexte();
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    const [papier] = await app
      .db('logement_consommable')
      .insert({ logement_id: logementId, label: 'Papier toilette', seuil_alerte: 2 })
      .returning('id');
    const [savon] = await app
      .db('logement_consommable')
      .insert({ logement_id: logementId, label: 'Savon', seuil_alerte: 1 })
      .returning('id');
    await app.db('menage_consommable_releve').insert([
      { logement_consommable_id: papier.id, qty: 1, recorded_by: admin.id }, // sous le seuil
      { logement_consommable_id: savon.id, qty: 5, recorded_by: admin.id },
    ]);

    const res = await app.inject({ method: 'GET', url: `/logements/${logementId}`, headers: auth(admin.token) });
    expect(res.json().consommables_alert).toBe(1);
  });
});

describe('archivage en cascade', () => {
  async function logementAvecContenu(ctx: Contexte) {
    const logementId = await createLogement(app, { organizationId: ctx.organizationId, createdBy: ctx.admin.id });
    const m1 = await createMenage(app, { logementId, organizationId: ctx.organizationId, createdBy: ctx.admin.id });
    const m2 = await createMenage(app, {
      logementId,
      organizationId: ctx.organizationId,
      createdBy: ctx.admin.id,
      datePrevue: '2026-07-02',
    });
    const [conso] = await app
      .db('logement_consommable')
      .insert({ logement_id: logementId, label: 'Savon' })
      .returning('id');
    return { logementId, menages: [m1, m2], consoId: conso.id as string };
  }

  it('archive le logement, ses prestations et ses consommables d’un coup', async () => {
    const ctx = await contexte();
    const { logementId, consoId } = await logementAvecContenu(ctx);

    const res = await app.inject({ method: 'DELETE', url: `/logements/${logementId}`, headers: auth(ctx.admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ archived_menages: 2 });

    const logement = await app.db('logement').where({ id: logementId }).first();
    expect(logement.archived_at).not.toBeNull();
    const menages = await app.db('menage').where({ logement_id: logementId }).whereNotNull('archived_at');
    expect(menages).toHaveLength(2);
    const conso = await app.db('logement_consommable').where({ id: consoId }).first();
    expect(conso.archived_at).not.toBeNull();

    // Disparu des listes actives, retrouvable dans la vue « archivés ».
    const actifs = await app.inject({ method: 'GET', url: '/logements', headers: auth(ctx.admin.token) });
    expect(actifs.json().data).toHaveLength(0);
    const archives = await app.inject({ method: 'GET', url: '/logements?archived=true', headers: auth(ctx.admin.token) });
    expect(archives.json().data.map((l: { id: string }) => l.id)).toEqual([logementId]);
    const prestations = await app.inject({ method: 'GET', url: '/menages', headers: auth(ctx.admin.token) });
    expect(prestations.json().data).toHaveLength(0);
  });

  it('ne restaure que ce que la même cascade avait archivé', async () => {
    const ctx = await contexte();
    const { logementId, menages, consoId } = await logementAvecContenu(ctx);
    // Une prestation archivée AVANT, pour une autre raison : elle doit le rester.
    await app.db('menage').where({ id: menages[1] }).update({ archived_at: new Date('2026-01-01') });

    await app.inject({ method: 'DELETE', url: `/logements/${logementId}`, headers: auth(ctx.admin.token) });
    const res = await app.inject({
      method: 'POST',
      url: `/logements/${logementId}/unarchive`,
      headers: auth(ctx.admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unarchived_menages: 1 });

    const logement = await app.db('logement').where({ id: logementId }).first();
    expect(logement.archived_at).toBeNull();
    const restaure = await app.db('menage').where({ id: menages[0] }).first();
    expect(restaure.archived_at).toBeNull();
    const toujoursArchive = await app.db('menage').where({ id: menages[1] }).first();
    expect(toujoursArchive.archived_at).not.toBeNull();
    const conso = await app.db('logement_consommable').where({ id: consoId }).first();
    expect(conso.archived_at).toBeNull();
  });

  it('archiver et restaurer sont réservés à l’admin ; la vue « archivés » aussi', async () => {
    const ctx = await contexte();
    const { logementId } = await logementAvecContenu(ctx);
    await addLogementMember(app, { logementId, userId: ctx.presta.id, role: 'manager' });

    expect(
      (await app.inject({ method: 'DELETE', url: `/logements/${logementId}`, headers: auth(ctx.presta.token) }))
        .statusCode,
    ).toBe(403);

    await app.inject({ method: 'DELETE', url: `/logements/${logementId}`, headers: auth(ctx.admin.token) });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/logements/${logementId}/unarchive`,
          headers: auth(ctx.presta.token),
        })
      ).statusCode,
    ).toBe(403);

    // Pour un non-admin, `?archived=true` est ignoré : il ne voit que l'actif.
    const vue = await app.inject({ method: 'GET', url: '/logements?archived=true', headers: auth(ctx.presta.token) });
    expect(vue.json().data).toHaveLength(0);
  });
});

describe('membres d’un logement', () => {
  it('applique les permissions par défaut du rôle', async () => {
    const { organizationId, admin, presta } = await contexte();
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });

    const res = await app.inject({
      method: 'POST',
      url: '/logement-members',
      headers: auth(admin.token),
      payload: { logement_id: logementId, user_id: presta.id, role: 'prestataire' },
    });
    expect(res.statusCode).toBe(201);
    // Un prestataire est « discret » par défaut : ni clients, ni équipe, ni édition.
    expect(res.json()).toMatchObject({
      can_view_checklist: true,
      can_view_clients: false,
      can_view_team: false,
      can_edit: false,
    });

    const doublon = await app.inject({
      method: 'POST',
      url: '/logement-members',
      headers: auth(admin.token),
      payload: { logement_id: logementId, user_id: presta.id, role: 'prestataire' },
    });
    expect(doublon.statusCode).toBe(409);
  });

  it('un manager du logement peut recruter, un simple prestataire non', async () => {
    const { organizationId, admin, presta } = await contexte();
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    const recrue = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    await addLogementMember(app, { logementId, userId: presta.id });

    const parPresta = await app.inject({
      method: 'POST',
      url: '/logement-members',
      headers: auth(presta.token),
      payload: { logement_id: logementId, user_id: recrue.id, role: 'prestataire' },
    });
    expect(parPresta.statusCode).toBe(403);

    const parManager = await app.inject({
      method: 'POST',
      url: '/logement-members',
      headers: auth(manager.token),
      payload: { logement_id: logementId, user_id: recrue.id, role: 'prestataire' },
    });
    expect(parManager.statusCode).toBe(201);
  });

  it('n’accepte pas un utilisateur d’une autre organisation', async () => {
    const { organizationId, admin } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const etranger = await createUser(app, { organizationId: autre.organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });

    const res = await app.inject({
      method: 'POST',
      url: '/logement-members',
      headers: auth(admin.token),
      payload: { logement_id: logementId, user_id: etranger.id, role: 'prestataire' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('changer le rôle réapplique les permissions du nouveau rôle', async () => {
    const { organizationId, admin, presta } = await contexte();
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    const membre = (
      await app.inject({
        method: 'POST',
        url: '/logement-members',
        headers: auth(admin.token),
        payload: { logement_id: logementId, user_id: presta.id, role: 'prestataire' },
      })
    ).json();

    const promu = await app.inject({
      method: 'PATCH',
      url: `/logement-members/${membre.id}`,
      headers: auth(admin.token),
      payload: { role: 'manager' },
    });
    expect(promu.statusCode).toBe(200);
    expect(promu.json()).toMatchObject({ role: 'manager', can_edit: true, can_view_clients: true, can_view_team: true });

    // Les permissions d'un membre ne se modifient pas depuis le terrain.
    const parSoi = await app.inject({
      method: 'PATCH',
      url: `/logement-members/${membre.id}`,
      headers: auth(presta.token),
      payload: { can_view_clients: true },
    });
    expect(parSoi.statusCode).toBe(403);
  });

  it('sans droit « voir l’équipe », un membre ne voit que sa propre ligne', async () => {
    const { organizationId, admin, presta } = await contexte();
    const collegue = await createUser(app, { organizationId, role: 'prestataire' });
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: presta.id });
    await addLogementMember(app, { logementId, userId: collegue.id });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    await app.db('logement_member').where({ user_id: manager.id }).update({ can_view_team: true });

    const vuePresta = await app.inject({
      method: 'GET',
      url: `/logement-members/by-logement?logement_id=${logementId}`,
      headers: auth(presta.token),
    });
    expect(vuePresta.json().data.map((m: { user_id: string }) => m.user_id)).toEqual([presta.id]);

    const vueManager = await app.inject({
      method: 'GET',
      url: `/logement-members/by-logement?logement_id=${logementId}`,
      headers: auth(manager.token),
    });
    expect(vueManager.json().data).toHaveLength(3);

    const etranger = await createUser(app, { organizationId, role: 'prestataire' });
    const vueEtranger = await app.inject({
      method: 'GET',
      url: `/logement-members/by-logement?logement_id=${logementId}`,
      headers: auth(etranger.token),
    });
    expect(vueEtranger.statusCode).toBe(403);
  });
});
