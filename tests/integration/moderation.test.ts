import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createSuperAdmin,
  createUser,
  type TestUser,
} from '../helpers/factories';
import { capturerPush, enregistrerAppareil, laisserPartirLesPush, type PushCapturee } from '../helpers/push';

/** Réponses, réactions, signalements et blocages (repris de Buildr). */

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
  /** Référent de la prestation. */
  titulaire: TestUser;
  /** Co-prestataire affecté. */
  collegue: TestUser;
  /** Prestataire de l'org, étranger au logement. */
  etranger: TestUser;
  logementId: string;
  menageId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const titulaire = await createUser(app, { organizationId, role: 'prestataire' });
  const collegue = await createUser(app, { organizationId, role: 'prestataire' });
  const etranger = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await addLogementMember(app, { logementId, userId: titulaire.id });
  await addLogementMember(app, { logementId, userId: collegue.id });
  const menageId = await createMenage(app, {
    logementId,
    organizationId,
    createdBy: admin.id,
    prestataireUserId: titulaire.id,
  });
  await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: collegue.id });
  return { organizationId, admin, titulaire, collegue, etranger, logementId, menageId };
}

async function commenter(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/comments', headers: auth(token), payload });
}

async function lireFil(token: string, menageId: string) {
  const res = await app.inject({ method: 'GET', url: `/comments?menage_id=${menageId}&order=asc`, headers: auth(token) });
  return res.json().data as {
    id: string;
    content: string;
    reply_to: { id: string; content: string } | null;
    reactions: { emoji: string; count: number; mine: boolean }[];
  }[];
}

async function signaler(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/reports', headers: auth(token), payload });
}

describe('réponses', () => {
  it('une réponse cite le message d’origine dans le fil', async () => {
    const { titulaire, collegue, menageId } = await contexte();
    const origine = (await commenter(titulaire.token, { menage_id: menageId, content: 'Les clés sont où ?' })).json();
    const res = await commenter(collegue.token, { menage_id: menageId, content: 'Boîte à clés', reply_to_id: origine.id });
    expect(res.statusCode).toBe(201);

    const fil = await lireFil(titulaire.token, menageId);
    expect(fil[1].reply_to).toMatchObject({ id: origine.id, content: 'Les clés sont où ?' });
  });

  it('on ne cite pas un message d’une autre prestation', async () => {
    const { organizationId, admin, titulaire, logementId, menageId } = await contexte();
    const autre = await createMenage(app, { logementId, organizationId, createdBy: admin.id, datePrevue: '2026-07-02' });
    const ailleurs = (await commenter(admin.token, { menage_id: autre, content: 'Ailleurs' })).json();
    const res = await commenter(titulaire.token, { menage_id: menageId, content: 'x', reply_to_id: ailleurs.id });
    expect(res.statusCode).toBe(400);
  });

  it('la réponse survit à la suppression du message cité, sans citation', async () => {
    const { titulaire, collegue, menageId } = await contexte();
    const origine = (await commenter(titulaire.token, { menage_id: menageId, content: 'Brouillon' })).json();
    await commenter(collegue.token, { menage_id: menageId, content: 'Réponse', reply_to_id: origine.id });
    await app.inject({ method: 'DELETE', url: `/comments/${origine.id}`, headers: auth(titulaire.token) });

    const fil = await lireFil(collegue.token, menageId);
    expect(fil).toHaveLength(1);
    expect(fil[0]).toMatchObject({ content: 'Réponse', reply_to: null });
  });
});

describe('réactions', () => {
  it('réagir est un interrupteur, et chacun voit si la réaction est la sienne', async () => {
    const { titulaire, collegue, admin, menageId } = await contexte();
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'Fini !' })).json();
    const reagir = (token: string, emoji: string) =>
      app.inject({ method: 'POST', url: `/comments/${msg.id}/reactions`, headers: auth(token), payload: { emoji } });

    expect((await reagir(collegue.token, '👍')).json().reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    await reagir(admin.token, '👍');
    expect((await lireFil(titulaire.token, menageId))[0].reactions).toEqual([{ emoji: '👍', count: 2, mine: false }]);

    // Deuxième appui : retirée.
    expect((await reagir(collegue.token, '👍')).json().reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
  });

  it('un emoji hors de la liste est refusé ; un étranger à la prestation ne réagit pas', async () => {
    const { titulaire, etranger, menageId } = await contexte();
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'Fini !' })).json();
    const horsListe = await app.inject({
      method: 'POST',
      url: `/comments/${msg.id}/reactions`,
      headers: auth(titulaire.token),
      payload: { emoji: '🍕' },
    });
    expect(horsListe.statusCode).toBe(400);
    const parEtranger = await app.inject({
      method: 'POST',
      url: `/comments/${msg.id}/reactions`,
      headers: auth(etranger.token),
      payload: { emoji: '👍' },
    });
    expect(parEtranger.statusCode).toBe(403);
  });
});

describe('signalements', () => {
  it('signaler un message : admins prévenus, jamais la personne visée ; re-signaler rend le même', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, admin.id);
    await enregistrerAppareil(app, titulaire.id);
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'Propos déplacés' })).json();

    const res = await signaler(collegue.token, { target_type: 'comment', target_id: msg.id, reason: 'harassment', comment: '  ' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      target_user_id: titulaire.id,
      target_excerpt: 'Propos déplacés',
      menage_id: menageId,
      reason: 'harassment',
      comment: null,
      status: 'pending',
      escalated: false,
    });

    const encore = await signaler(collegue.token, { target_type: 'comment', target_id: msg.id, reason: 'other' });
    expect(encore.statusCode).toBe(200);
    expect(encore.json().id).toBe(res.json().id);

    await laisserPartirLesPush();
    const signalements = push.messages.filter((m) => m.data.type === 'content_report');
    expect(signalements.map((m) => m.to)).toEqual([jetonAdmin]);
    expect(signalements[0].data).toMatchObject({ report_id: res.json().id });
  });

  it('signaler une photo ou un membre', async () => {
    const { titulaire, collegue, menageId } = await contexte();
    const [photo] = await app
      .db('photo')
      .insert({ menage_id: menageId, uploaded_by: titulaire.id, url: 'https://cdn.test/p.jpg', taken_at: new Date() })
      .returning('id');
    const surPhoto = await signaler(collegue.token, { target_type: 'photo', target_id: photo.id, reason: 'inappropriate' });
    expect(surPhoto.statusCode).toBe(201);
    expect(surPhoto.json().target_user_id).toBe(titulaire.id);

    const surMembre = await signaler(collegue.token, { target_type: 'user', target_id: titulaire.id, reason: 'harassment' });
    expect(surMembre.statusCode).toBe(201);
    expect(surMembre.json()).toMatchObject({ target_user_id: titulaire.id, menage_id: null });
  });

  it('une cible invisible est introuvable ; on ne se signale pas soi-même', async () => {
    const { titulaire, etranger, menageId } = await contexte();
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'x' })).json();
    expect((await signaler(etranger.token, { target_type: 'comment', target_id: msg.id, reason: 'other' })).statusCode).toBe(404);
    expect((await signaler(titulaire.token, { target_type: 'comment', target_id: msg.id, reason: 'other' })).statusCode).toBe(400);

    const { admin: autreAdmin } = await createOrgWithAdmin(app, 'Autre conciergerie');
    expect((await signaler(titulaire.token, { target_type: 'user', target_id: autreAdmin.id, reason: 'other' })).statusCode).toBe(404);
  });

  it('un admin visé : les autres admins et la console sont prévenus, lui ne voit pas le signalement', async () => {
    const { organizationId, admin, titulaire } = await contexte();
    const autreAdmin = await createUser(app, { organizationId, role: 'admin' });
    const { organizationId: orgSupport } = await createOrgWithAdmin(app, 'Support');
    const support = await createSuperAdmin(app, orgSupport);
    await enregistrerAppareil(app, admin.id);
    const jetonAutre = await enregistrerAppareil(app, autreAdmin.id);
    const jetonSupport = await enregistrerAppareil(app, support.id);

    const res = await signaler(titulaire.token, { target_type: 'user', target_id: admin.id, reason: 'harassment' });
    expect(res.json().escalated).toBe(true);

    await laisserPartirLesPush();
    expect(push.messages.map((m) => m.to).sort()).toEqual([jetonAutre, jetonSupport].sort());

    const vuParVise = await app.inject({ method: 'GET', url: '/reports', headers: auth(admin.token) });
    expect(vuParVise.json().data).toHaveLength(0);
    const traiteParVise = await app.inject({
      method: 'PATCH',
      url: `/reports/${res.json().id}`,
      headers: auth(admin.token),
      payload: { status: 'dismissed' },
    });
    expect(traiteParVise.statusCode).toBe(404);

    const console = await app.inject({ method: 'GET', url: '/super-admin/reports?escalated=1', headers: auth(support.token) });
    expect(console.json().data.map((r: { id: string }) => r.id)).toEqual([res.json().id]);
  });

  it('l’admin traite : statut, note, compteur en attente ; un prestataire n’y a pas accès', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'x' })).json();
    const report = (await signaler(collegue.token, { target_type: 'comment', target_id: msg.id, reason: 'off_topic' })).json();

    expect((await app.inject({ method: 'GET', url: '/reports', headers: auth(collegue.token) })).statusCode).toBe(403);
    const avant = await app.inject({ method: 'GET', url: '/reports', headers: auth(admin.token) });
    expect(avant.json().counts.pending).toBe(1);
    expect(avant.json().data[0]).toMatchObject({ target_exists: true, reporter_first_name: 'Test' });

    // Le message est supprimé : le signalement survit et le dit.
    await app.inject({ method: 'DELETE', url: `/comments/${msg.id}`, headers: auth(admin.token) });
    const traite = await app.inject({
      method: 'PATCH',
      url: `/reports/${report.id}`,
      headers: auth(admin.token),
      payload: { status: 'resolved', resolution_note: 'Message supprimé' },
    });
    expect(traite.json()).toMatchObject({ status: 'resolved', resolution_note: 'Message supprimé', resolved_by: admin.id });

    const apres = await app.inject({ method: 'GET', url: '/reports', headers: auth(admin.token) });
    expect(apres.json().counts.pending).toBe(0);
    expect(apres.json().data[0].target_exists).toBe(false);
  });
});

describe('blocages', () => {
  it('les messages, citations et photos d’une personne bloquée disparaissent pour celui qui bloque, et lui seul', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    const msg = (await commenter(titulaire.token, { menage_id: menageId, content: 'Message de Titulaire' })).json();
    await commenter(admin.token, { menage_id: menageId, content: 'Réponse admin', reply_to_id: msg.id });
    await app
      .db('photo')
      .insert({ menage_id: menageId, uploaded_by: titulaire.id, url: 'https://cdn.test/p.jpg', taken_at: new Date() });

    const bloque = await app.inject({ method: 'POST', url: '/blocks', headers: auth(collegue.token), payload: { user_id: titulaire.id } });
    expect(bloque.statusCode).toBe(201);

    const fil = await lireFil(collegue.token, menageId);
    expect(fil.map((c) => c.content)).toEqual(['Réponse admin']);
    expect(fil[0].reply_to).toBeNull();
    const photos = await app.inject({ method: 'GET', url: `/photos?menage_id=${menageId}`, headers: auth(collegue.token) });
    expect(photos.json().data).toHaveLength(0);

    // Les autres voient tout.
    expect((await lireFil(admin.token, menageId)).map((c) => c.content)).toEqual(['Message de Titulaire', 'Réponse admin']);

    const liste = await app.inject({ method: 'GET', url: '/blocks', headers: auth(collegue.token) });
    expect(liste.json().data).toEqual([expect.objectContaining({ user_id: titulaire.id })]);

    await app.inject({ method: 'DELETE', url: `/blocks/${titulaire.id}`, headers: auth(collegue.token) });
    expect(await lireFil(collegue.token, menageId)).toHaveLength(2);
  });

  it('on ne bloque ni soi-même ni quelqu’un d’une autre organisation', async () => {
    const { titulaire } = await contexte();
    const { admin: inconnu } = await createOrgWithAdmin(app, 'Autre');
    const soi = await app.inject({ method: 'POST', url: '/blocks', headers: auth(titulaire.token), payload: { user_id: titulaire.id } });
    expect(soi.statusCode).toBe(400);
    const ailleurs = await app.inject({ method: 'POST', url: '/blocks', headers: auth(titulaire.token), payload: { user_id: inconnu.id } });
    expect(ailleurs.statusCode).toBe(404);
  });
});
