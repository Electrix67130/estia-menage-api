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
  /** Référent de la prestation, membre du logement. */
  titulaire: TestUser;
  /** Membre prestataire du logement, PAS affecté. */
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
  return { organizationId, admin, titulaire, collegue, etranger, logementId, menageId };
}

const PHOTO = { url: 'https://cdn.test/photo.jpg', taken_at: '2026-07-01T10:00:00.000Z' };

async function posterPhoto(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/photos', headers: auth(token), payload });
}

async function commenter(token: string, menageId: string, content: string, section_id?: string) {
  return app.inject({
    method: 'POST',
    url: '/comments',
    headers: auth(token),
    payload: section_id ? { menage_id: menageId, content, section_id } : { menage_id: menageId, content },
  });
}

describe('photos de prestation', () => {
  it('le prestataire affecté en ajoute, un étranger au logement non', async () => {
    const { titulaire, etranger, menageId } = await contexte();
    expect((await posterPhoto(etranger.token, { ...PHOTO, menage_id: menageId })).statusCode).toBe(403);
    const ok = await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ menage_id: menageId, uploaded_by: titulaire.id });
  });

  it('un remplaçant affecté sans être membre du logement peut aussi en ajouter', async () => {
    const { etranger, menageId } = await contexte();
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: etranger.id });
    expect((await posterPhoto(etranger.token, { ...PHOTO, menage_id: menageId })).statusCode).toBe(201);
  });

  it('pas de galerie sur un check-in / check-out', async () => {
    const { titulaire, menageId } = await contexte();
    await app.db('menage').where({ id: menageId }).update({ prestation_type: 'check_in' });
    const res = await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId });
    expect(res.statusCode).toBe(400);
  });

  it('refuse une pièce (section) qui n’appartient pas à la prestation', async () => {
    const { organizationId, admin, titulaire, logementId, menageId } = await contexte();
    const autreMenage = await createMenage(app, { logementId, organizationId, createdBy: admin.id, datePrevue: '2026-07-02' });
    const [section] = await app
      .db('menage_check_section')
      .insert({ menage_id: autreMenage, section_type: 'kitchen', section_label: 'Cuisine' })
      .returning('id');
    const res = await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId, section_id: section.id });
    expect(res.statusCode).toBe(404);
  });

  it('les photos de référence du logement : écriture admin, lecture par toute l’organisation', async () => {
    const { admin, titulaire, etranger, logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const [room] = await app.db('logement_room').insert({ logement_id: logementId, name: 'Salon' }).returning('id');

    expect((await posterPhoto(titulaire.token, { ...PHOTO, logement_id: logementId })).statusCode).toBe(403);
    const ok = await posterPhoto(admin.token, { ...PHOTO, logement_id: logementId, logement_room_id: room.id });
    expect(ok.statusCode).toBe(201);

    // Même un prestataire non membre : il doit savoir à quoi doit ressembler le logement.
    const lecture = await app.inject({ method: 'GET', url: `/photos?logement_id=${logementId}`, headers: auth(etranger.token) });
    expect(lecture.statusCode).toBe(200);
    expect(lecture.json().data).toHaveLength(1);
    expect(lecture.json().data[0].logement_room_id).toBe(room.id);

    const voisine = await app.inject({ method: 'GET', url: `/photos?logement_id=${logementId}`, headers: auth(autre.admin.token) });
    expect(voisine.statusCode).toBe(404);
  });

  it('une pièce d’un autre logement est refusée', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const autreLogement = await createLogement(app, { organizationId, createdBy: admin.id });
    const [room] = await app.db('logement_room').insert({ logement_id: autreLogement, name: 'Salon' }).returning('id');
    const res = await posterPhoto(admin.token, { ...PHOTO, logement_id: logementId, logement_room_id: room.id });
    expect(res.statusCode).toBe(404);
  });

  it('l’auteur supprime sa photo ; un collègue sans droit d’édition, non', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    const photo = (await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId })).json();
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: collegue.id });

    expect((await app.inject({ method: 'DELETE', url: `/photos/${photo.id}`, headers: auth(collegue.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/photos/${photo.id}`, headers: auth(titulaire.token) })).statusCode).toBe(204);

    const autre = (await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId })).json();
    expect((await app.inject({ method: 'DELETE', url: `/photos/${autre.id}`, headers: auth(admin.token) })).statusCode).toBe(204);
  });

  it('signe les URLs internes à la lecture, et laisse les autres telles quelles', async () => {
    const { titulaire, menageId } = await contexte();
    await posterPhoto(titulaire.token, {
      ...PHOTO,
      menage_id: menageId,
      url: `${process.env.APP_URL}/files/abc.jpg`,
      thumbnail_url: 'https://cdn.externe/abc_thumb.jpg',
    });
    const res = await app.inject({ method: 'GET', url: `/photos?menage_id=${menageId}`, headers: auth(titulaire.token) });
    const [photo] = res.json().data;
    expect(photo.url).toMatch(/\/files\/abc\.jpg\?t=/);
    expect(photo.thumbnail_url).toBe('https://cdn.externe/abc_thumb.jpg');
  });
});

describe('commentaires', () => {
  it('prévient les admins et les affectés, pas l’auteur ni un membre non affecté', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, admin.id);
    await enregistrerAppareil(app, titulaire.id);
    await enregistrerAppareil(app, collegue.id);

    const res = await commenter(titulaire.token, menageId, 'Linge manquant');
    expect(res.statusCode).toBe(201);

    await laisserPartirLesPush();
    expect(push.messages.map((m) => m.to)).toEqual([jetonAdmin]);
    expect(push.messages[0]).toMatchObject({ title: 'Nouveau commentaire' });
    expect(push.messages[0].data).toMatchObject({ type: 'comment', menage_id: menageId });
  });

  it('la lecture est fermée à un étranger ; une section d’une autre prestation est refusée', async () => {
    const { organizationId, admin, titulaire, etranger, logementId, menageId } = await contexte();
    expect((await app.inject({ method: 'GET', url: `/comments?menage_id=${menageId}`, headers: auth(etranger.token) })).statusCode).toBe(403);

    const autreMenage = await createMenage(app, { logementId, organizationId, createdBy: admin.id, datePrevue: '2026-07-02' });
    const [section] = await app
      .db('menage_check_section')
      .insert({ menage_id: autreMenage, section_type: 'kitchen', section_label: 'Cuisine' })
      .returning('id');
    expect((await commenter(titulaire.token, menageId, 'x', section.id)).statusCode).toBe(400);
  });

  it('seul l’auteur modifie ; l’admin peut supprimer, un collègue affecté non', async () => {
    const { admin, titulaire, collegue, menageId } = await contexte();
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: collegue.id });
    const commentaire = (await commenter(titulaire.token, menageId, 'Brouillon')).json();

    const parCollegue = await app.inject({
      method: 'PATCH',
      url: `/comments/${commentaire.id}`,
      headers: auth(collegue.token),
      payload: { content: 'Modifié' },
    });
    expect(parCollegue.statusCode).toBe(403);
    const parAuteur = await app.inject({
      method: 'PATCH',
      url: `/comments/${commentaire.id}`,
      headers: auth(titulaire.token),
      payload: { content: 'Corrigé' },
    });
    expect(parAuteur.json().content).toBe('Corrigé');

    expect((await app.inject({ method: 'DELETE', url: `/comments/${commentaire.id}`, headers: auth(collegue.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/comments/${commentaire.id}`, headers: auth(admin.token) })).statusCode).toBe(204);
  });

  it('sépare le fil général des commentaires d’étape', async () => {
    const { titulaire, menageId } = await contexte();
    const [section] = await app
      .db('menage_check_section')
      .insert({ menage_id: menageId, section_type: 'kitchen', section_label: 'Cuisine' })
      .returning('id');
    await commenter(titulaire.token, menageId, 'Général');
    await commenter(titulaire.token, menageId, 'Four à refaire', section.id);

    const general = await app.inject({ method: 'GET', url: `/comments?menage_id=${menageId}&section_id=general`, headers: auth(titulaire.token) });
    expect(general.json().data.map((c: { content: string }) => c.content)).toEqual(['Général']);
    const etape = await app.inject({ method: 'GET', url: `/comments?menage_id=${menageId}&section_id=${section.id}`, headers: auth(titulaire.token) });
    expect(etape.json().data.map((c: { content: string }) => c.content)).toEqual(['Four à refaire']);
    const tout = await app.inject({ method: 'GET', url: `/comments?menage_id=${menageId}`, headers: auth(titulaire.token) });
    expect(tout.json().meta.total).toBe(2);
  });
});

describe('badges « non lus »', () => {
  const resume = async (token: string) => {
    const res = await app.inject({ method: 'GET', url: '/menage-views/unread-summary', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      by_menage: Record<string, number>;
      by_organization: Record<string, number>;
      by_type: Record<string, number>;
    };
  };

  it('compte pour l’admin ce que le prestataire a posté, jusqu’à ce qu’il l’ouvre', async () => {
    const { organizationId, admin, titulaire, menageId } = await contexte();
    await commenter(titulaire.token, menageId, 'Linge manquant');
    await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId });

    const avant = await resume(admin.token);
    expect(avant.by_menage[menageId]).toBe(2);
    expect(avant.by_organization[organizationId]).toBe(2);
    expect(avant.by_type).toEqual({ menage: 2 });

    // Il ouvre l'onglet commentaires : il reste la photo.
    const vu = await app.inject({
      method: 'POST',
      url: '/menage-views',
      headers: auth(admin.token),
      payload: { menage_id: menageId, tab: 'comments' },
    });
    expect(vu.statusCode).toBe(204);
    const apres = await resume(admin.token);
    expect(apres.by_menage[menageId]).toBe(1);
  });

  it('ne compte pas ce qu’on a posté soi-même', async () => {
    const { titulaire, menageId } = await contexte();
    await commenter(titulaire.token, menageId, 'Ma note');
    const res = await resume(titulaire.token);
    expect(res.by_menage).toEqual({});
  });

  it('un prestataire n’a de badge que sur SES prestations ; un manager sur tout le logement', async () => {
    const { organizationId, admin, titulaire, collegue, logementId, menageId } = await contexte();
    const manager = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: manager.id, role: 'manager' });
    await commenter(admin.token, menageId, 'Pensez aux clés');

    expect((await resume(titulaire.token)).by_menage[menageId]).toBe(1);
    expect((await resume(collegue.token)).by_menage).toEqual({});
    expect((await resume(manager.token)).by_menage[menageId]).toBe(1);
  });

  it('ventile par type de prestation et ignore les prestations clôturées', async () => {
    const { organizationId, admin, titulaire, logementId, menageId } = await contexte();
    const checkIn = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: titulaire.id,
      datePrevue: '2026-07-02',
    });
    await app.db('menage').where({ id: checkIn }).update({ prestation_type: 'check_in' });
    await commenter(titulaire.token, menageId, 'Ménage');
    await commenter(titulaire.token, checkIn, 'Arrivée');

    expect((await resume(admin.token)).by_type).toEqual({ menage: 1, check_in: 1 });

    await app.db('menage').where({ id: menageId }).update({ status: 'valide' });
    const apres = await resume(admin.token);
    expect(apres.by_type).toEqual({ check_in: 1 });
    expect(apres.by_menage[menageId]).toBeUndefined();
  });

  it('le détail d’une prestation distingue commentaires, étapes et photos', async () => {
    const { admin, titulaire, menageId } = await contexte();
    const [section] = await app
      .db('menage_check_section')
      .insert({ menage_id: menageId, section_type: 'kitchen', section_label: 'Cuisine' })
      .returning('id');
    await commenter(titulaire.token, menageId, 'Général');
    await commenter(titulaire.token, menageId, 'Four', section.id);
    await posterPhoto(titulaire.token, { ...PHOTO, menage_id: menageId });

    const res = await app.inject({ method: 'GET', url: `/menage-views/unread?menage_id=${menageId}`, headers: auth(admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      comments: 1,
      comments_steps: 1,
      photos: 1,
      unread_step_ids: [section.id],
      comments_last_viewed_at: null,
    });
  });
});

describe('appareils et préférences de notifications', () => {
  it('enregistre un appareil ; un même jeton suit le dernier compte connecté', async () => {
    const { titulaire, collegue } = await contexte();
    const token = 'ExponentPushToken[partage]';
    const premier = await app.inject({
      method: 'POST',
      url: '/device-tokens',
      headers: auth(titulaire.token),
      payload: { token, platform: 'ios' },
    });
    expect(premier.statusCode).toBe(201);

    // Téléphone partagé / re-login : l'appareil passe au nouveau compte.
    await app.inject({ method: 'POST', url: '/device-tokens', headers: auth(collegue.token), payload: { token } });
    const rows = await app.db('device_token').where({ token });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(collegue.id);

    const suppression = await app.inject({ method: 'DELETE', url: '/device-tokens', headers: auth(collegue.token), payload: { token } });
    expect(suppression.statusCode).toBe(204);
    expect(await app.db('device_token').where({ token })).toHaveLength(0);
  });

  it('tout est activé par défaut ; couper une catégorie ne touche pas les autres', async () => {
    const { titulaire } = await contexte();
    const avant = await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(titulaire.token) });
    expect(avant.statusCode).toBe(200);
    expect(Object.values(avant.json() as Record<string, boolean>).every(Boolean)).toBe(true);

    const maj = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: auth(titulaire.token),
      payload: { key: 'comments', enabled: false },
    });
    expect(maj.json()).toEqual({ key: 'comments', enabled: false });

    const apres = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(titulaire.token) })).json();
    expect(apres.comments).toBe(false);
    expect(apres.assignment).toBe(true);

    const inconnue = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: auth(titulaire.token),
      payload: { key: 'meteo', enabled: false },
    });
    expect(inconnue.statusCode).toBe(400);
  });
});
