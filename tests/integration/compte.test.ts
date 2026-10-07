import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  TEST_PASSWORD,
  addLogementMember,
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createUser,
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

describe('suppression de son compte (App Store 5.1.1)', () => {
  it('exige le bon mot de passe', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: auth(marie.token),
      payload: { password: 'pas-le-bon' },
    });
    expect(res.statusCode).toBe(401);
    expect(await app.db('organization_member').where({ user_id: marie.id })).toHaveLength(1);
  });

  it('anonymise la personne, coupe ses accès, désaffecte ses prestations à venir et garde l’historique', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    await enregistrerAppareil(app, marie.id);
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: marie.id });
    const passee = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: marie.id,
      datePrevue: '2020-01-10',
      status: 'valide',
    });
    const future = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: marie.id,
      datePrevue: '2999-01-10',
    });
    const [comment] = await app
      .db('comment')
      .insert({ menage_id: passee, author_id: marie.id, content: 'Tout est propre' })
      .returning('id');

    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: auth(marie.token),
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(204);

    const user = await app.db('user').where({ id: marie.id }).first();
    expect(user.email).toBe(`deleted-${marie.id}@deleted.invalid`);
    expect(user.first_name).toBe('Compte');
    expect(user.last_name).toBe('supprimé');
    expect(user.is_active).toBe(false);
    expect(user.phone).toBeNull();

    expect(await app.db('organization_member').where({ user_id: marie.id })).toHaveLength(0);
    expect(await app.db('logement_member').where({ user_id: marie.id })).toHaveLength(0);
    expect(await app.db('device_token').where({ user_id: marie.id })).toHaveLength(0);
    expect(await app.db('refresh_token').where({ user_id: marie.id })).toHaveLength(0);

    // Historique conservé, prestation future libérée.
    expect((await app.db('menage').where({ id: passee }).first()).prestataire_user_id).toBe(marie.id);
    expect((await app.db('menage').where({ id: future }).first()).prestataire_user_id).toBeNull();
    expect(await app.db('menage_prestataire').where({ menage_id: future, user_id: marie.id })).toHaveLength(0);
    expect(await app.db('comment').where({ id: comment.id })).toHaveLength(1);

    // Plus aucun accès : ancien jeton refusé, ancien login impossible.
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(marie.token) });
    expect(me.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: marie.email, password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it('refuse au dernier admin d’une organisation qui a encore des membres', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: auth(admin.token),
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(await app.db('organization_member').where({ user_id: admin.id })).toHaveLength(1);
  });

  it('accepte un admin seul dans son organisation', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Solo');
    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: auth(admin.token),
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('signalement de contenu (App Store 1.2)', () => {
  it('un membre signale un commentaire ; les admins de l’org le voient et reçoivent une push', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const jetonAdmin = await enregistrerAppareil(app, admin.id);
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const sofia = await createUser(app, { organizationId, role: 'prestataire' });
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    const [comment] = await app
      .db('comment')
      .insert({ menage_id: menageId, author_id: sofia.id, content: 'Propos déplacés' })
      .returning('id');

    const res = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(marie.token),
      payload: {
        type: 'report',
        subject: 'Commentaire inapproprié',
        message: 'Ce commentaire contient des propos déplacés envers un collègue.',
        target_type: 'comment',
        target_id: comment.id,
        platform: 'mobile',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: 'report', target_type: 'comment', target_id: comment.id, status: 'new' });

    const liste = await app.inject({ method: 'GET', url: '/feedbacks?type=report', headers: auth(admin.token) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json().data.map((f: { id: string }) => f.id)).toContain(res.json().id);

    await laisserPartirLesPush();
    expect(push.messages.map((m) => m.to)).toEqual([jetonAdmin]);
    expect(push.messages[0].title).toBe('Contenu signalé');
    expect(push.messages[0].data).toMatchObject({ type: 'content_report', feedback_id: res.json().id });
  });

  it('un bug ou une suggestion ne déclenche pas de push admin', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    await enregistrerAppareil(app, admin.id);
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'POST',
      url: '/feedbacks',
      headers: auth(marie.token),
      payload: { type: 'bug', subject: 'La galerie est vide', message: 'Depuis ce matin, plus aucune photo.' },
    });
    expect(res.statusCode).toBe(201);
    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(0);
  });
});
