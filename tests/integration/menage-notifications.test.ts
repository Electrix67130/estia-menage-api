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
  presta: TestUser;
  jeton: string;
  logementId: string;
  menageId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const jeton = await enregistrerAppareil(app, presta.id);
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await addLogementMember(app, { logementId, userId: presta.id });
  const menageId = await createMenage(app, {
    logementId,
    organizationId,
    createdBy: admin.id,
    prestataireUserId: presta.id,
    datePrevue: '2026-07-01',
  });
  await app.db('menage').where({ id: menageId }).update({ horaire_prevu: '09:00' });
  return { organizationId, admin, presta, jeton, logementId, menageId };
}

describe('annulation d’une prestation', () => {
  it('prévient le prestataire affecté', async () => {
    const { admin, menageId, jeton } = await contexte();

    await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}`,
      headers: auth(admin.token),
      payload: { status: 'annule' },
    });
    await laisserPartirLesPush();

    const recu = push.messages.find((m) => m.to === jeton);
    expect(recu).toBeDefined();
    expect(recu?.title).toBe('Ménage annulé');
    expect(recu?.data).toMatchObject({ menage_id: menageId, type: 'cancelled' });
  });

  it('prévient aussi quand la prestation est supprimée', async () => {
    const { admin, menageId, jeton } = await contexte();

    await app.inject({ method: 'DELETE', url: `/menages/${menageId}`, headers: auth(admin.token) });
    await laisserPartirLesPush();

    expect(push.messages.find((m) => m.to === jeton)?.title).toBe('Ménage annulé');
  });

  it('ne renotifie pas une prestation déjà annulée', async () => {
    const { admin, menageId, jeton } = await contexte();
    const annuler = () =>
      app.inject({
        method: 'PATCH',
        url: `/menages/${menageId}`,
        headers: auth(admin.token),
        payload: { status: 'annule' },
      });

    await annuler();
    await laisserPartirLesPush();
    await annuler();
    await laisserPartirLesPush();

    expect(push.messages.filter((m) => m.to === jeton)).toHaveLength(1);
  });
});

describe('report d’une prestation', () => {
  it('annonce la nouvelle date et la nouvelle heure', async () => {
    const { admin, menageId, jeton } = await contexte();

    await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}`,
      headers: auth(admin.token),
      payload: { date_prevue: '2026-07-08', horaire_prevu: '14:30' },
    });
    await laisserPartirLesPush();

    const recu = push.messages.find((m) => m.to === jeton);
    expect(recu?.title).toBe('Ménage reporté');
    // La nouvelle date dans le corps : sans elle, il faut ouvrir l'application
    // pour savoir quand venir.
    expect(recu?.body).toContain('8 juillet');
    expect(recu?.body).toContain('14:30');
    expect(recu?.data).toMatchObject({ type: 'updated' });
  });

  it('ne notifie pas quand la date est renvoyée inchangée', async () => {
    // Un formulaire d'édition renvoie tous les champs : `date_prevue` arrive en
    // « 2026-07-01 » face à un objet Date, et `horaire_prevu` en « 09:00 » face
    // à « 09:00:00 ». Comparés bruts, ils paraissaient toujours modifiés.
    const { admin, menageId, jeton } = await contexte();

    await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}`,
      headers: auth(admin.token),
      payload: { date_prevue: '2026-07-01', horaire_prevu: '09:00', prix_prevu: 95 },
    });
    await laisserPartirLesPush();

    expect(push.messages.filter((m) => m.to === jeton)).toHaveLength(0);
  });

  it('n’envoie rien à l’auteur de la modification', async () => {
    const { organizationId, admin, menageId } = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, admin.id, 'ExponentPushToken[admin]');
    // L'admin est aussi affecté : il ne doit pas se notifier lui-même.
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: admin.id });
    expect(organizationId).toBeDefined();

    await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}`,
      headers: auth(admin.token),
      payload: { date_prevue: '2026-07-09' },
    });
    await laisserPartirLesPush();

    expect(push.messages.filter((m) => m.to === jetonAdmin)).toHaveLength(0);
  });
});

describe('demande de report', () => {
  async function demander(ctx: Contexte): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/reschedule-requests',
      headers: auth(ctx.presta.token),
      payload: {
        menage_id: ctx.menageId,
        proposed_date: '2026-07-10',
        proposed_time: '11:00',
        reason: 'Empêchement',
      },
    });
    if (res.statusCode !== 201) throw new Error(`Demande refusée : ${res.statusCode} ${res.body}`);
    return res.json().id;
  }

  it('prévient les admins de la demande', async () => {
    const ctx = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, ctx.admin.id, 'ExponentPushToken[admin]');

    await demander(ctx);
    await laisserPartirLesPush();

    const recu = push.messages.find((m) => m.to === jetonAdmin);
    expect(recu?.title).toBe('Demande de report');
    expect(recu?.data).toMatchObject({ type: 'reschedule_request' });
  });

  it('annonce au demandeur la décision de l’admin', async () => {
    const ctx = await contexte();
    const demandeId = await demander(ctx);

    await app.inject({
      method: 'POST',
      url: `/reschedule-requests/${demandeId}/decide`,
      headers: auth(ctx.admin.token),
      payload: { decision: 'approved', apply_to_menage: true },
    });
    await laisserPartirLesPush();

    const recu = push.messages.filter((m) => m.to === ctx.jeton).at(-1);
    expect(recu?.title).toBe('Demande de report acceptée');
    expect(recu?.data).toMatchObject({ type: 'reschedule_decision' });
  });

  it('prévient un refus aussi', async () => {
    const ctx = await contexte();
    const demandeId = await demander(ctx);

    await app.inject({
      method: 'POST',
      url: `/reschedule-requests/${demandeId}/decide`,
      headers: auth(ctx.admin.token),
      payload: { decision: 'rejected' },
    });
    await laisserPartirLesPush();

    expect(push.messages.filter((m) => m.to === ctx.jeton).at(-1)?.title).toBe(
      'Demande de report refusée',
    );
  });

  it('prévient les autres prestataires affectés de la nouvelle date', async () => {
    // Le demandeur reçoit la réponse à sa demande ; un co-prestataire, lui, n'a
    // rien demandé et découvrirait le déplacement en arrivant sur place.
    const ctx = await contexte();
    const coPresta = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    const jetonCo = await enregistrerAppareil(app, coPresta.id, 'ExponentPushToken[co]');
    await addLogementMember(app, { logementId: ctx.logementId, userId: coPresta.id });
    await app.db('menage_prestataire').insert({ menage_id: ctx.menageId, user_id: coPresta.id });

    const demandeId = await demander(ctx);
    await app.inject({
      method: 'POST',
      url: `/reschedule-requests/${demandeId}/decide`,
      headers: auth(ctx.admin.token),
      payload: { decision: 'approved', apply_to_menage: true },
    });
    await laisserPartirLesPush();

    const recu = push.messages.find((m) => m.to === jetonCo);
    expect(recu?.title).toBe('Ménage reporté');
    expect(recu?.body).toContain('10 juillet');
  });

  it('ne dérange personne d’autre quand le report est refusé', async () => {
    const ctx = await contexte();
    const coPresta = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    const jetonCo = await enregistrerAppareil(app, coPresta.id, 'ExponentPushToken[co]');
    await app.db('menage_prestataire').insert({ menage_id: ctx.menageId, user_id: coPresta.id });

    const demandeId = await demander(ctx);
    await app.inject({
      method: 'POST',
      url: `/reschedule-requests/${demandeId}/decide`,
      headers: auth(ctx.admin.token),
      payload: { decision: 'rejected' },
    });
    await laisserPartirLesPush();

    expect(push.messages.filter((m) => m.to === jetonCo)).toHaveLength(0);
  });
});

describe('préférences de notifications', () => {
  it('respecte la catégorie coupée par le prestataire', async () => {
    const { admin, presta, menageId, jeton } = await contexte();
    await app.db('user').where({ id: presta.id }).update({ notification_prefs: { assignment: false } });

    await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}`,
      headers: auth(admin.token),
      payload: { status: 'annule' },
    });
    await laisserPartirLesPush();

    // Annulations et reports relèvent de la catégorie « assignment ».
    expect(push.messages.filter((m) => m.to === jeton)).toHaveLength(0);
  });
});
