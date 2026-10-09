import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createOrgWithAdmin,
  createUser,
} from '../helpers/factories';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

describe('organisation', () => {
  it('renvoie l’organisation active et ne laisse qu’un admin la modifier', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });

    const lecture = await app.inject({ method: 'GET', url: '/organization', headers: auth(presta.token) });
    expect(lecture.statusCode).toBe(200);
    expect(lecture.json().name).toBe('Conciergerie');

    const refus = await app.inject({
      method: 'PATCH',
      url: '/organization',
      headers: auth(presta.token),
      payload: { name: 'Piratée' },
    });
    expect(refus.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/organization',
      headers: auth(admin.token),
      payload: { name: 'Conciergerie Bleue', siret: '12345678901234' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Conciergerie Bleue', siret: '12345678901234' });
  });

  it('refuse un SIRET mal formé', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({
      method: 'PATCH',
      url: '/organization',
      headers: auth(admin.token),
      payload: { siret: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('créer une organisation en fait l’admin et la rend active', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: auth(admin.token),
      payload: { name: 'Seconde activité' },
    });
    expect(res.statusCode).toBe(201);
    const nouvelle = res.json().id as string;

    const memberships = (
      await app.inject({ method: 'GET', url: '/organization-members/me', headers: auth(admin.token) })
    ).json() as { organization_id: string; role: string }[];
    expect(memberships.map((m) => m.organization_id).sort()).toEqual([organizationId, nouvelle].sort());
    expect(memberships.every((m) => m.role === 'admin')).toBe(true);

    const active = (await app.inject({ method: 'GET', url: '/organization', headers: auth(admin.token) })).json();
    expect(active.id).toBe(nouvelle);
  });
});

describe('invitations', () => {
  it('seul un admin invite', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(presta.token),
      payload: { email: 'x@test.local' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuse d’inviter quelqu’un qui est déjà membre', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(admin.token),
      payload: { email: presta.email.toUpperCase() },
    });
    expect(res.statusCode).toBe(409);
  });

  it('ré-inviter la même adresse réutilise l’invitation en attente avec un nouveau jeton', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const premiere = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'nouveau@test.local', role: 'prestataire' },
      })
    ).json();
    const seconde = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'Nouveau@test.local', role: 'admin' },
      })
    ).json();

    expect(seconde.id).toBe(premiere.id);
    expect(seconde.token).not.toBe(premiere.token);
    expect(seconde.role).toBe('admin');
    expect(await app.db('invitation').where({ organization_id: organizationId })).toHaveLength(1);
  });

  it('la liste est propre à l’organisation et assainit les invitations orphelines', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(autre.admin.token),
      payload: { email: 'chez-voisine@test.local' },
    });
    await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(admin.token),
      payload: { email: 'rejoint-autrement@test.local' },
    });
    // La personne a rejoint l'org sans passer par le lien (ajout manuel).
    await createUser(app, { organizationId, role: 'prestataire', email: 'rejoint-autrement@test.local' });

    const res = await app.inject({ method: 'GET', url: '/invitations', headers: auth(admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0]).toMatchObject({ email: 'rejoint-autrement@test.local', status: 'accepted' });
  });

  it('le jeton pré-remplit l’inscription, et un jeton inconnu ne révèle rien', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const inv = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'nouveau@test.local', role: 'admin' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/invitations/by-token/${inv.token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'nouveau@test.local', role: 'admin', organization_name: 'Conciergerie' });

    expect((await app.inject({ method: 'GET', url: '/invitations/by-token/inconnu' })).statusCode).toBe(404);
  });

  it('le renvoi prolonge l’invitation, mais pas une invitation déjà acceptée', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const inv = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'nouveau@test.local' },
      })
    ).json();
    await app.db('invitation').where({ id: inv.id }).update({ expires_at: new Date(Date.now() - 1000), status: 'expired' });

    const renvoi = await app.inject({ method: 'POST', url: `/invitations/${inv.id}/resend`, headers: auth(admin.token) });
    expect(renvoi.statusCode).toBe(200);
    expect(renvoi.json().status).toBe('pending');
    expect(new Date(renvoi.json().expires_at).getTime()).toBeGreaterThan(Date.now());

    await app.db('invitation').where({ id: inv.id }).update({ status: 'accepted' });
    const refus = await app.inject({ method: 'POST', url: `/invitations/${inv.id}/resend`, headers: auth(admin.token) });
    expect(refus.statusCode).toBe(409);
  });

  it('le renvoi ne traverse pas les organisations', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const inv = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'nouveau@test.local' },
      })
    ).json();
    const res = await app.inject({ method: 'POST', url: `/invitations/${inv.id}/resend`, headers: auth(autre.admin.token) });
    expect(res.statusCode).toBe(404);
  });

  // BUG — src/modules/invitation/index.ts, route `DELETE /invitations/:id`
  // (~l. 95) : aucune vérification du rôle ni de l'organisation. N'importe quel
  // compte authentifié, même d'une autre org, annule l'invitation.
  // Attendu : 404 pour un étranger ; observé : 204 et la ligne est supprimée.
  it('l’annulation d’une invitation est réservée à l’organisation qui l’a émise', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const inv = (
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'nouveau@test.local' },
      })
    ).json();
    const res = await app.inject({ method: 'DELETE', url: `/invitations/${inv.id}`, headers: auth(autre.admin.token) });
    expect(res.statusCode).toBe(404);
    expect(await app.db('invitation').where({ id: inv.id })).toHaveLength(1);
  });
});

describe('utilisateurs', () => {
  it('l’admin voit toute l’équipe, un prestataire seulement ceux qui partagent un logement avec lui', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const sofia = await createUser(app, { organizationId, role: 'prestataire' });
    await createUser(app, { organizationId, role: 'prestataire' }); // isolé
    const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
    await addLogementMember(app, { logementId, userId: marie.id });
    await addLogementMember(app, { logementId, userId: sofia.id });

    const vueAdmin = await app.inject({ method: 'GET', url: '/users', headers: auth(admin.token) });
    expect(vueAdmin.json().meta.total).toBe(4);

    const vueMarie = await app.inject({ method: 'GET', url: '/users', headers: auth(marie.token) });
    expect(vueMarie.json().data.map((u: { id: string }) => u.id)).toEqual([sofia.id]);
  });

  it('la recherche ne sort pas de l’organisation', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    await createUser(app, { organizationId, role: 'prestataire', email: 'cible@test.local' });
    await createUser(app, { organizationId: autre.organizationId, role: 'prestataire', email: 'cible-voisine@test.local' });

    const res = await app.inject({ method: 'GET', url: '/users/search?q=cible', headers: auth(admin.token) });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].email).toBe('cible@test.local');
  });

  it('chacun modifie son profil, mais pas son rôle ni celui d’un collègue', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const sofia = await createUser(app, { organizationId, role: 'prestataire' });

    const soi = await app.inject({
      method: 'PATCH',
      url: `/users/${marie.id}`,
      headers: auth(marie.token),
      payload: { first_name: 'Marie', provider_company: 'Marie Nettoyage' },
    });
    expect(soi.statusCode).toBe(200);
    expect(soi.json()).toMatchObject({ first_name: 'Marie', provider_company: 'Marie Nettoyage' });
    expect(soi.json().password_hash).toBeUndefined();

    const role = await app.inject({
      method: 'PATCH',
      url: `/users/${marie.id}`,
      headers: auth(marie.token),
      payload: { role: 'admin' },
    });
    expect(role.statusCode).toBe(403);

    const collegue = await app.inject({
      method: 'PATCH',
      url: `/users/${sofia.id}`,
      headers: auth(marie.token),
      payload: { first_name: 'Hack' },
    });
    expect(collegue.statusCode).toBe(403);
  });

  it('le nom de société posé par l’admin se propage à toute l’équipe et à l’organisation', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${admin.id}`,
      headers: auth(admin.token),
      payload: { company_name: 'Estia Propreté' },
    });
    expect(res.statusCode).toBe(200);
    const membre = await app.db('user').where({ id: presta.id }).first();
    expect(membre.company_name).toBe('Estia Propreté');
    const org = await app.db('organization').where({ id: organizationId }).first();
    expect(org.name).toBe('Estia Propreté');
  });

  it('la suppression d’un compte est réservée à l’admin', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });
    const sofia = await createUser(app, { organizationId, role: 'prestataire' });

    expect(
      (await app.inject({ method: 'DELETE', url: `/users/${sofia.id}`, headers: auth(marie.token) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/users/${sofia.id}`, headers: auth(admin.token) })).statusCode,
    ).toBe(204);
    expect(await app.db('user').where({ id: sofia.id })).toHaveLength(0);
  });

  // BUG — src/modules/user/index.ts, routes `GET /users/:id` (~l. 58) et
  // `DELETE /users/:id` (~l. 122) : la cible n'est pas rapprochée de
  // l'organisation de l'appelant. Un admin d'une autre org lit la fiche
  // (e-mail, téléphone) et peut supprimer le compte.
  // Attendu : 404 ; observé : 200 à la lecture (et 204 à la suppression).
  it('la fiche et la suppression d’un utilisateur ne traversent pas les organisations', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });

    const fiche = await app.inject({ method: 'GET', url: `/users/${marie.id}`, headers: auth(autre.admin.token) });
    expect(fiche.statusCode).toBe(404);
    const suppression = await app.inject({ method: 'DELETE', url: `/users/${marie.id}`, headers: auth(autre.admin.token) });
    expect(suppression.statusCode).toBe(404);
    expect(await app.db('user').where({ id: marie.id })).toHaveLength(1);
  });
});

describe('disponibilités hebdomadaires', () => {
  it('part d’une semaine vide, se met à jour jour par jour, et se lit en lot côté admin', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const marie = await createUser(app, { organizationId, role: 'prestataire' });

    const initiale = await app.inject({
      method: 'GET',
      url: '/prestataires/me/weekly-availability',
      headers: auth(marie.token),
    });
    expect(initiale.statusCode).toBe(200);
    expect(initiale.json()).toMatchObject({ monday: false, sunday: false });

    const maj = await app.inject({
      method: 'PATCH',
      url: '/prestataires/me/weekly-availability',
      headers: auth(marie.token),
      payload: { monday: true, friday: true },
    });
    expect(maj.json()).toMatchObject({ monday: true, friday: true, tuesday: false });

    const lot = await app.inject({
      method: 'GET',
      url: `/prestataires/weekly-availability?user_ids=${marie.id}`,
      headers: auth(admin.token),
    });
    expect(lot.statusCode).toBe(200);
    expect(lot.json().data).toHaveLength(1);
    expect(lot.json().data[0]).toMatchObject({ user_id: marie.id, monday: true });

    const refus = await app.inject({
      method: 'GET',
      url: `/prestataires/weekly-availability?user_ids=${marie.id}`,
      headers: auth(marie.token),
    });
    expect(refus.statusCode).toBe(403);
  });
});

describe('modification d’un compte par un admin', () => {
  it('un admin ne modifie pas un compte d’une autre organisation', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie A');
    const { organizationId: orgB } = await createOrgWithAdmin(app, 'Conciergerie B');
    const victime = await createUser(app, { organizationId: orgB, role: 'prestataire' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${victime.id}`,
      headers: auth(admin.token),
      payload: { is_active: false, role: 'admin' },
    });
    expect(res.statusCode).toBe(404);
    const apres = await app.db('user').where({ id: victime.id }).first();
    expect(apres).toMatchObject({ is_active: true, role: 'prestataire' });
  });

  it('il désactive bien un membre de sa propre organisation', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie A');
    const membre = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${membre.id}`,
      headers: auth(admin.token),
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(200);
    expect((await app.db('user').where({ id: membre.id }).first()).is_active).toBe(false);
  });
});
