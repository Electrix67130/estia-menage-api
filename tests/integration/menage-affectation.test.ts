import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { todayYmd } from '@/lib/date';
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
  marie: TestUser;
  sofia: TestUser;
  logementId: string;
  menageId: string;
}

/** Un logement avec deux prestataires membres et une prestation libre. */
async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const marie = await createUser(app, { organizationId, role: 'prestataire' });
  const sofia = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await addLogementMember(app, { logementId, userId: marie.id });
  await addLogementMember(app, { logementId, userId: sofia.id });
  const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
  return { organizationId, admin, marie, sofia, logementId, menageId };
}

async function affectes(menageId: string, token: string) {
  const res = await app.inject({ method: 'GET', url: `/menages/${menageId}/prestataires`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json().data as { user_id: string; is_primary: boolean }[];
}

async function referent(menageId: string): Promise<string | null> {
  const row = await app.db('menage').where({ id: menageId }).first('prestataire_user_id');
  return row.prestataire_user_id;
}

describe('multi-affectation', () => {
  it('seul l’admin affecte, et uniquement des prestataires de l’organisation', async () => {
    const { admin, marie, menageId } = await contexte();
    const parPresta = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(marie.token),
      payload: { prestataire_user_ids: [marie.id] },
    });
    expect(parPresta.statusCode).toBe(403);

    // L'admin n'est pas un prestataire : on ne l'affecte pas.
    const pasPresta = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(admin.token),
      payload: { prestataire_user_ids: [admin.id] },
    });
    expect(pasPresta.statusCode).toBe(400);
  });

  it('le premier de la liste devient référent ; remplacer la liste prévient les arrivants et les sortants', async () => {
    const { admin, marie, sofia, menageId } = await contexte();
    const jetonMarie = await enregistrerAppareil(app, marie.id);
    const jetonSofia = await enregistrerAppareil(app, sofia.id);

    const premiere = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(admin.token),
      payload: { prestataire_user_ids: [marie.id, sofia.id] },
    });
    expect(premiere.statusCode).toBe(200);
    expect(premiere.json().data.map((p: { user_id: string; is_primary: boolean }) => [p.user_id, p.is_primary])).toEqual([
      [marie.id, true],
      [sofia.id, false],
    ]);
    expect(await referent(menageId)).toBe(marie.id);

    await laisserPartirLesPush();
    expect(push.messages.map((m) => m.to).sort()).toEqual([jetonMarie, jetonSofia].sort());
    push.messages.length = 0;

    // Sofia seule : Marie est retirée et prévenue, Sofia n'est pas re-notifiée.
    await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(admin.token),
      payload: { prestataire_user_ids: [sofia.id] },
    });
    expect(await referent(menageId)).toBe(sofia.id);
    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({ to: jetonMarie, title: 'Ménage retiré' });
  });

  it('ajouter un prestataire est idempotent et ne le notifie qu’une fois', async () => {
    const { admin, marie, sofia, menageId } = await contexte();
    const jetonSofia = await enregistrerAppareil(app, sofia.id);
    const ajouter = (userId: string) =>
      app.inject({ method: 'POST', url: `/menages/${menageId}/prestataires/${userId}`, headers: auth(admin.token) });

    await ajouter(marie.id);
    await ajouter(sofia.id);
    await ajouter(sofia.id);

    const liste = await affectes(menageId, admin.token);
    expect(liste.map((p) => p.user_id)).toEqual([marie.id, sofia.id]);
    expect(liste[0].is_primary).toBe(true);
    expect(await referent(menageId)).toBe(marie.id);

    await laisserPartirLesPush();
    expect(push.messages.filter((m) => m.to === jetonSofia)).toHaveLength(1);
  });

  it('désigner le référent ne change pas la liste, seulement qui la mène', async () => {
    const { admin, marie, sofia, menageId } = await contexte();
    await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(admin.token),
      payload: { prestataire_user_ids: [marie.id, sofia.id] },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires/${sofia.id}/primary`,
      headers: auth(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const liste = res.json().data as { user_id: string; is_primary: boolean }[];
    expect(liste.map((p) => p.user_id).sort()).toEqual([marie.id, sofia.id].sort());
    expect(liste.find((p) => p.is_primary)?.user_id).toBe(sofia.id);
    expect(await referent(menageId)).toBe(sofia.id);

    const etranger = await createUser(app, { organizationId: marie.organizationId, role: 'prestataire' });
    const pasAffecte = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires/${etranger.id}/primary`,
      headers: auth(admin.token),
    });
    expect(pasAffecte.statusCode).toBe(400);
  });

  it('retirer le référent passe le relais au suivant ; retirer le dernier libère la prestation', async () => {
    const { admin, marie, sofia, menageId } = await contexte();
    await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/prestataires`,
      headers: auth(admin.token),
      payload: { prestataire_user_ids: [marie.id, sofia.id] },
    });
    const retirer = (userId: string) =>
      app.inject({ method: 'DELETE', url: `/menages/${menageId}/prestataires/${userId}`, headers: auth(admin.token) });

    expect((await retirer(marie.id)).statusCode).toBe(204);
    expect(await referent(menageId)).toBe(sofia.id);
    expect((await retirer(sofia.id)).statusCode).toBe(204);
    expect(await referent(menageId)).toBeNull();
    expect(await affectes(menageId, admin.token)).toHaveLength(0);
  });
});

describe('réponses présent / absent', () => {
  const voter = (menageId: string, token: string, status: 'present' | 'absent', user_id?: string) =>
    app.inject({
      method: 'POST',
      url: `/menages/${menageId}/responses`,
      headers: auth(token),
      payload: user_id ? { status, user_id } : { status },
    });

  it('un membre prestataire se positionne ; l’admin n’est prévenu que si la réponse change', async () => {
    const { admin, marie, menageId } = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, admin.id);

    const premier = await voter(menageId, marie.token, 'present');
    expect(premier.statusCode).toBe(200);
    expect(premier.json()).toMatchObject({ user_id: marie.id, status: 'present' });
    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({ to: jetonAdmin });
    expect(push.messages[0].data).toMatchObject({ type: 'response', menage_id: menageId });

    // Re-confirmer la même chose : silence.
    await voter(menageId, marie.token, 'present');
    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);

    // Changer d'avis : nouvelle push, et une seule ligne en base.
    await voter(menageId, marie.token, 'absent');
    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(2);
    expect(await app.db('menage_response').where({ menage_id: menageId })).toHaveLength(1);
  });

  it('refuse un prestataire étranger au logement et une prestation déjà validée', async () => {
    const { organizationId, admin, marie, menageId } = await contexte();
    const etranger = await createUser(app, { organizationId, role: 'prestataire' });
    expect((await voter(menageId, etranger.token, 'present')).statusCode).toBe(403);

    await app.db('menage').where({ id: menageId }).update({ status: 'valide' });
    expect((await voter(menageId, marie.token, 'present')).statusCode).toBe(400);
    void admin;
  });

  it('l’admin peut répondre à la place d’un prestataire du logement, pas un collègue', async () => {
    const { organizationId, admin, marie, sofia, menageId } = await contexte();
    const parCollegue = await voter(menageId, sofia.token, 'present', marie.id);
    expect(parCollegue.statusCode).toBe(403);

    const parAdmin = await voter(menageId, admin.token, 'present', marie.id);
    expect(parAdmin.statusCode).toBe(200);
    expect(parAdmin.json()).toMatchObject({ user_id: marie.id, status: 'present' });

    const horsLogement = await createUser(app, { organizationId, role: 'prestataire' });
    expect((await voter(menageId, admin.token, 'present', horsLogement.id)).statusCode).toBe(400);
  });

  it('la liste des réponses est visible de l’admin et des membres du logement seulement', async () => {
    const { organizationId, admin, marie, menageId } = await contexte();
    await voter(menageId, marie.token, 'present');
    const etranger = await createUser(app, { organizationId, role: 'prestataire' });

    const vueAdmin = await app.inject({ method: 'GET', url: `/menages/${menageId}/responses`, headers: auth(admin.token) });
    expect(vueAdmin.statusCode).toBe(200);
    expect(vueAdmin.json().data).toHaveLength(1);
    expect(vueAdmin.json().data[0]).toMatchObject({ user_id: marie.id, first_name: 'Test' });

    const vueEtranger = await app.inject({ method: 'GET', url: `/menages/${menageId}/responses`, headers: auth(etranger.token) });
    expect(vueEtranger.statusCode).toBe(403);
  });
});

describe('mes prochaines prestations (vue prestataire)', () => {
  it('montre ce qui est à prendre ou à soi, jamais ce qui est pris par un autre', async () => {
    const { organizationId, admin, marie, sofia, logementId, menageId: libre } = await contexte();
    const aujourdhui = todayYmd();
    await app.db('menage').where({ id: libre }).update({ date_prevue: aujourdhui });
    const base = { logementId, organizationId, createdBy: admin.id, datePrevue: aujourdhui };
    const priseParSofia = await createMenage(app, { ...base, prestataireUserId: sofia.id });
    // Marie remplace sur un logement dont elle n'est PAS membre : elle ne voit que celle-là.
    const autreLogement = await createLogement(app, { organizationId, createdBy: admin.id });
    const remplacement = await createMenage(app, {
      ...base,
      logementId: autreLogement,
      prestataireUserId: marie.id,
    });
    await createMenage(app, { ...base, logementId: autreLogement }); // libre mais hors de ses logements
    await app.db('menage_response').insert({ menage_id: libre, user_id: marie.id, status: 'present' });

    const res = await app.inject({ method: 'GET', url: '/prestataires/me/menages', headers: auth(marie.token) });
    expect(res.statusCode).toBe(200);
    const parId = new Map((res.json().data as Array<Record<string, unknown>>).map((m) => [m.id, m]));
    expect([...parId.keys()].sort()).toEqual([libre, remplacement].sort());
    expect(parId.has(priseParSofia)).toBe(false);
    expect(parId.get(libre)).toMatchObject({ my_response: 'present', is_assigned: false, assigned_to_someone: false });
    expect(parId.get(remplacement)).toMatchObject({ is_assigned: true, done_by_me: true, assigned_to_someone: true });
  });

  it('en mode historique, ne liste que ce qui a été fait', async () => {
    const { organizationId, admin, marie, logementId, menageId: aVenir } = await contexte();
    const hier = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const faite = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: marie.id,
      datePrevue: hier,
      status: 'termine',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/prestataires/me/menages?mode=history',
      headers: auth(marie.token),
    });
    const ids = (res.json().data as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual([faite]);
    expect(ids).not.toContain(aVenir);
  });
});
