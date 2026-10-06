import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { capturerPush, enregistrerAppareil, laisserPartirLesPush, type PushCapturee } from '../helpers/push';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

let push: { messages: PushCapturee[]; restore: () => void };
beforeEach(async () => {
  await truncateAll(app.db);
  push = capturerPush();
});
afterEach(() => push.restore());

interface Contexte {
  organizationId: string;
  admin: TestUser;
  /** Prestataire membre du logement. */
  presta: TestUser;
  logementId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Villa Rose' });
  await app.db('logement').where({ id: logementId }).update({ n_lit_double: 2, n_lit_simple: 1, n_lit_parapluie: 1 });
  await addLogementMember(app, { logementId, userId: presta.id });
  return { organizationId, admin, presta, logementId };
}

async function creer(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/menages', headers: auth(token), payload });
}

async function modifier(token: string, menageId: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url: `/menages/${menageId}`, headers: auth(token), payload });
}

describe('création manuelle d’une prestation', () => {
  it('est réservée à l’admin, et au logement de son organisation', async () => {
    const { admin, presta, logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');

    expect((await creer(presta.token, { logement_id: logementId, date_prevue: '2026-07-01' })).statusCode).toBe(403);
    expect((await creer(autre.admin.token, { logement_id: logementId, date_prevue: '2026-07-01' })).statusCode).toBe(400);
    expect((await creer(admin.token, { logement_id: logementId, date_prevue: '2026-07-01' })).statusCode).toBe(201);
  });

  it('reprend les couchages du logement, sauf ceux fournis', async () => {
    const { admin, logementId } = await contexte();
    const res = await creer(admin.token, {
      logement_id: logementId,
      date_prevue: '2026-07-01',
      n_lit_simple: 3,
      prestation_type: 'menage',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      n_lit_simple: 3, // fourni
      n_lit_double: 2, // hérité du logement
      n_lit_parapluie: 1,
      status: 'a_venir',
      prestation_type: 'menage',
    });
  });

  it('affectée d’emblée : la jointure est posée et le prestataire est prévenu, pas le créateur', async () => {
    const { admin, presta, logementId } = await contexte();
    const jetonPresta = await enregistrerAppareil(app, presta.id);
    await enregistrerAppareil(app, admin.id);

    const res = await creer(admin.token, {
      logement_id: logementId,
      date_prevue: '2026-07-01',
      prestataire_user_id: presta.id,
    });
    expect(res.statusCode).toBe(201);
    const affectes = await app.db('menage_prestataire').where({ menage_id: res.json().id });
    expect(affectes.map((a) => a.user_id)).toEqual([presta.id]);

    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({ to: jetonPresta, title: 'Nouveau ménage assigné' });
    expect(push.messages[0].data).toMatchObject({ menage_id: res.json().id, type: 'assignment' });
  });

  it('sans prestataire : les prestataires du logement apprennent qu’une prestation est à prendre', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const jetonPresta = await enregistrerAppareil(app, presta.id);
    const horsLogement = await createUser(app, { organizationId, role: 'prestataire' });
    await enregistrerAppareil(app, horsLogement.id);

    await creer(admin.token, { logement_id: logementId, date_prevue: '2026-07-01' });

    await laisserPartirLesPush();
    expect(push.messages.map((m) => m.to)).toEqual([jetonPresta]);
    expect(push.messages[0].title).toBe('Nouveau ménage disponible');
    expect(push.messages[0].body).toContain('Villa Rose');
  });

  it('refuse d’affecter quelqu’un d’une autre organisation', async () => {
    const { admin, logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const etranger = await createUser(app, { organizationId: autre.organizationId, role: 'prestataire' });
    const res = await creer(admin.token, {
      logement_id: logementId,
      date_prevue: '2026-07-01',
      prestataire_user_id: etranger.id,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('modification d’une prestation', () => {
  it('un manager du logement édite les notes, mais ni le statut, ni les tarifs, ni l’affectation', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    await app.db('logement_member').where({ user_id: manager.id }).update({ can_edit: true });
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });

    expect((await modifier(manager.token, menageId, { notes_intervention: 'Clés sous le pot' })).statusCode).toBe(200);
    expect((await modifier(manager.token, menageId, { status: 'annule' })).statusCode).toBe(403);
    expect((await modifier(manager.token, menageId, { provider_price: 10 })).statusCode).toBe(403);
    expect((await modifier(manager.token, menageId, { prestataire_user_id: presta.id })).statusCode).toBe(403);
    // Un simple membre prestataire sans can_edit ne modifie rien du tout.
    expect((await modifier(presta.token, menageId, { notes_intervention: 'x' })).statusCode).toBe(403);
  });

  it('repasser « à venir » efface les pointages, repasser « en cours » n’efface que le départ', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, status: 'termine' });
    await app.db('menage').where({ id: menageId }).update({ arrived_at: new Date(), departed_at: new Date() });

    const enCours = await modifier(admin.token, menageId, { status: 'en_cours' });
    expect(enCours.json()).toMatchObject({ status: 'en_cours', departed_at: null });
    expect(enCours.json().arrived_at).not.toBeNull();

    const aVenir = await modifier(admin.token, menageId, { status: 'a_venir' });
    expect(aVenir.json()).toMatchObject({ status: 'a_venir', arrived_at: null, departed_at: null });
  });

  it('déplacer à la main une prestation iCal verrouille sa date contre la prochaine synchro', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const [cal] = await app
      .db('logement_external_calendar')
      .insert({ logement_id: logementId, provider: 'airbnb', url: 'https://exemple.test/a.ics' })
      .returning('id');
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    await app.db('menage').where({ id: menageId }).update({ external_calendar_id: cal.id, external_source: 'airbnb' });

    const deplace = await modifier(admin.token, menageId, { date_prevue: '2026-07-03' });
    expect(deplace.json().date_locked).toBe(true);

    // Le toggle explicite de l'admin l'emporte sur l'automatisme.
    const deverrouille = await modifier(admin.token, menageId, { date_prevue: '2026-07-04', date_locked: false });
    expect(deverrouille.json().date_locked).toBe(false);
  });

  it('ne change de prestataire que vers un membre de l’organisation, et prévient l’ancien', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const remplacant = await createUser(app, { organizationId, role: 'prestataire' });
    const jetonAncien = await enregistrerAppareil(app, presta.id);
    const jetonNouveau = await enregistrerAppareil(app, remplacant.id);
    const menageId = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: presta.id,
    });

    const res = await modifier(admin.token, menageId, { prestataire_user_id: remplacant.id });
    expect(res.statusCode).toBe(200);
    const affectes = await app.db('menage_prestataire').where({ menage_id: menageId });
    expect(affectes.map((a) => a.user_id)).toEqual([remplacant.id]);

    await laisserPartirLesPush();
    const parJeton = new Map(push.messages.map((m) => [m.to, m.title]));
    expect(parJeton.get(jetonNouveau)).toBe('Nouveau ménage assigné');
    expect(parJeton.get(jetonAncien)).toBe('Ménage retiré');
  });
});

describe('suppression et remise', () => {
  it('une prestation manuelle est supprimée pour de bon, par l’admin seulement', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });

    expect((await app.inject({ method: 'DELETE', url: `/menages/${menageId}`, headers: auth(presta.token) })).statusCode).toBe(403);
    const res = await app.inject({ method: 'DELETE', url: `/menages/${menageId}`, headers: auth(admin.token) });
    expect(res.statusCode).toBe(204);
    expect(await app.db('menage').where({ id: menageId })).toHaveLength(0);
  });

  it('une prestation iCal est seulement retirée (annulée + ignorée), puis peut être remise', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    await app.db('menage').where({ id: menageId }).update({ external_source: 'airbnb', external_event_uid: 'uid-1' });

    const retrait = await app.inject({ method: 'DELETE', url: `/menages/${menageId}`, headers: auth(admin.token) });
    expect(retrait.statusCode).toBe(200);
    expect(retrait.json()).toEqual({ soft: true, sync_ignored: true });
    let row = await app.db('menage').where({ id: menageId }).first();
    expect(row).toMatchObject({ status: 'annule', sync_ignored: true });

    expect(
      (await app.inject({ method: 'POST', url: `/menages/${menageId}/restore`, headers: auth(presta.token) })).statusCode,
    ).toBe(403);
    const remise = await app.inject({ method: 'POST', url: `/menages/${menageId}/restore`, headers: auth(admin.token) });
    expect(remise.statusCode).toBe(200);
    row = await app.db('menage').where({ id: menageId }).first();
    expect(row).toMatchObject({ status: 'a_venir', sync_ignored: false });
  });
});

describe('détail d’une prestation', () => {
  it('un membre prestataire ne peut pas ouvrir une prestation affectée à un autre', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const titulaire = await createUser(app, { organizationId, role: 'prestataire' });
    const menageId = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: titulaire.id,
    });
    const res = await app.inject({ method: 'GET', url: `/menages/${menageId}`, headers: auth(presta.token) });
    expect(res.statusCode).toBe(404);
  });

  it('un co-prestataire non membre du logement y accède, et un manager aussi', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const remplacant = await createUser(app, { organizationId, role: 'prestataire' });
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    const menageId = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: presta.id,
    });
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: remplacant.id });

    expect((await app.inject({ method: 'GET', url: `/menages/${menageId}`, headers: auth(remplacant.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/menages/${menageId}`, headers: auth(manager.token) })).statusCode).toBe(200);
  });

  it('cache le prix client au prestataire, et aussi sa rémunération à un simple manager', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    const menageId = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: presta.id,
    });
    await app.db('menage').where({ id: menageId }).update({ client_price_ht: 90, provider_price: 55 });

    const lire = async (token: string) =>
      (await app.inject({ method: 'GET', url: `/menages/${menageId}`, headers: auth(token) })).json();

    const vueAdmin = await lire(admin.token);
    expect(Number(vueAdmin.client_price_ht)).toBe(90);
    expect(Number(vueAdmin.provider_price)).toBe(55);

    const vuePresta = await lire(presta.token);
    expect(vuePresta.client_price_ht).toBeUndefined();
    expect(Number(vuePresta.provider_price)).toBe(55);

    const vueManager = await lire(manager.token);
    expect(vueManager.client_price_ht).toBeUndefined();
    expect(vueManager.provider_price).toBeUndefined();
  });

  it('expose le logement joint, le code boîte à clés et le drapeau « report en attente »', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    await app.db('logement').where({ id: logementId }).update({ key_safe_code: '1984', address: '1 rue des Lilas' });
    const menageId = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: presta.id,
    });
    await app.db('menage_reschedule_request').insert({
      menage_id: menageId,
      requested_by: presta.id,
      original_date: '2026-07-01',
      proposed_date: '2026-07-02',
    });

    const res = await app.inject({ method: 'GET', url: `/menages/${menageId}`, headers: auth(presta.token) });
    expect(res.json()).toMatchObject({
      logement_name: 'Villa Rose',
      logement_address: '1 rue des Lilas',
      logement_key_safe_code: '1984',
      has_pending_reschedule: true,
      prestataire_first_name: 'Test',
    });
  });
});

describe('filtres de la liste', () => {
  it('isole les non assignées, un type, un logement et une période', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const autreLogement = await createLogement(app, { organizationId, createdBy: admin.id });
    const base = { organizationId, createdBy: admin.id };
    const libre = await createMenage(app, { ...base, logementId, datePrevue: '2026-07-01' });
    const prise = await createMenage(app, { ...base, logementId, datePrevue: '2026-07-05', prestataireUserId: presta.id });
    const ailleurs = await createMenage(app, { ...base, logementId: autreLogement, datePrevue: '2026-08-01' });
    await app.db('menage').where({ id: ailleurs }).update({ prestation_type: 'check_in' });

    const ids = async (query: string) => {
      const res = await app.inject({ method: 'GET', url: `/menages?${query}`, headers: auth(admin.token) });
      expect(res.statusCode).toBe(200);
      return (res.json().data as { id: string }[]).map((m) => m.id).sort();
    };

    expect(await ids('unassigned=true')).toEqual([libre, ailleurs].sort());
    expect(await ids('unassigned=false')).toEqual([prise]);
    expect(await ids('type=check_in')).toEqual([ailleurs]);
    expect(await ids(`logement_id=${autreLogement}`)).toEqual([ailleurs]);
    expect(await ids('from=2026-07-02&to=2026-07-31')).toEqual([prise]);
    expect(await ids('prestataire_user_id=' + presta.id)).toEqual([prise]);
  });

  it('refuse une valeur de statut inconnue', async () => {
    const { admin } = await contexte();
    const res = await app.inject({ method: 'GET', url: '/menages?status=perdu', headers: auth(admin.token) });
    expect(res.statusCode).toBe(400);
  });
});
