import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  TEST_PASSWORD,
  createOrgWithAdmin,
  createOrganization,
  createUser,
  login,
} from '../helpers/factories';
import { capturerPush, enregistrerAppareil, laisserPartirLesPush, type PushCapturee } from '../helpers/push';

// Capture des e-mails sortants. SMTP est vide en test : `sendMail` se contente
// de journaliser, on ne saurait donc jamais quel lien de réinitialisation ou
// d'invitation a été envoyé. `vi.hoisted` : le mock est remonté au-dessus des
// imports, le tableau doit exister avant que le module mocké ne soit chargé.
const { mails } = vi.hoisted(() => ({ mails: [] as { to: string; subject: string; html: string }[] }));
vi.mock('@/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mailer')>();
  return {
    ...actual,
    sendMail: vi.fn(async (opts: { to: string; subject: string; html: string }) => {
      mails.push(opts);
    }),
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

let push: { messages: PushCapturee[]; restore: () => void };
beforeEach(async () => {
  await truncateAll(app.db);
  mails.length = 0;
  push = capturerPush();
});
afterEach(() => push.restore());

const NOUVEAU_MDP = 'NouveauMotDePasse42';

async function connexion(email: string, password = TEST_PASSWORD, platform: 'web' | 'mobile' = 'web') {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password, platform } });
}

describe('connexion', () => {
  it('refuse un mauvais mot de passe sans dire lequel des deux est faux', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const mauvais = await connexion(admin.email, 'pas-le-bon-mot-de-passe');
    expect(mauvais.statusCode).toBe(401);
    const inconnu = await connexion('personne@test.local');
    expect(inconnu.statusCode).toBe(401);
    expect(inconnu.json().message).toBe(mauvais.json().message);
  });

  it('ferme la porte à un compte désactivé', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    await app.db('user').where({ id: admin.id }).update({ is_active: false });
    expect((await connexion(admin.email)).statusCode).toBe(401);
  });

  it('expose le profil sans le mot de passe, avec le rôle de l’organisation active', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(admin.token) });
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.password_hash).toBeUndefined();
    expect(me.role).toBe('admin');
    expect(me.organization_id).toBe(organizationId);
    expect(me.memberships).toEqual([
      { organization_id: organizationId, organization_name: 'Conciergerie', role: 'admin' },
    ]);
  });
});

describe('sessions', () => {
  it('fait tourner le jeton de rafraîchissement : l’ancien ne sert qu’une fois', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const { refresh_token } = (await connexion(admin.email)).json();

    const premier = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });
    expect(premier.statusCode).toBe(200);
    expect(premier.json().refresh_token).not.toBe(refresh_token);

    const rejoue = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });
    expect(rejoue.statusCode).toBe(401);
  });

  it('une nouvelle connexion sur la même plateforme invalide la précédente, pas l’autre plateforme', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const web1 = (await connexion(admin.email, TEST_PASSWORD, 'web')).json().access_token as string;
    const mobile = (await connexion(admin.email, TEST_PASSWORD, 'mobile')).json().access_token as string;
    const web2 = (await connexion(admin.email, TEST_PASSWORD, 'web')).json().access_token as string;

    const me = (token: string) => app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
    expect((await me(web1)).statusCode).toBe(401);
    expect((await me(web2)).statusCode).toBe(200);
    // Le téléphone n'est pas déconnecté par une connexion sur le dashboard.
    expect((await me(mobile)).statusCode).toBe(200);
  });

  it('la déconnexion d’un appareil ne touche pas les autres ; sans jeton, elle coupe tout', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const web = (await connexion(admin.email, TEST_PASSWORD, 'web')).json();
    const mobile = (await connexion(admin.email, TEST_PASSWORD, 'mobile')).json();

    const me = (token: string) => app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });

    const logoutWeb = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: auth(web.access_token),
      payload: { refresh_token: web.refresh_token },
    });
    expect(logoutWeb.statusCode).toBe(204);
    expect((await me(web.access_token)).statusCode).toBe(401);
    expect((await me(mobile.access_token)).statusCode).toBe(200);

    const logoutTotal = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(mobile.access_token) });
    expect(logoutTotal.statusCode).toBe(204);
    expect((await me(mobile.access_token)).statusCode).toBe(401);
    expect(await app.db('refresh_token').where({ user_id: admin.id })).toHaveLength(0);
  });
});

describe('mot de passe', () => {
  it('exige le mot de passe courant pour le changer', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: auth(admin.token),
      payload: { current_password: 'faux', new_password: NOUVEAU_MDP },
    });
    expect(res.statusCode).toBe(401);
  });

  it('le changement révoque les autres sessions et rend l’ancien mot de passe inutilisable', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: auth(admin.token),
      payload: { current_password: TEST_PASSWORD, new_password: NOUVEAU_MDP },
    });
    expect(res.statusCode).toBe(200);
    expect(await app.db('refresh_token').where({ user_id: admin.id })).toHaveLength(0);
    expect((await connexion(admin.email, TEST_PASSWORD)).statusCode).toBe(401);
    expect((await connexion(admin.email, NOUVEAU_MDP)).statusCode).toBe(200);
  });

  it('refuse un mot de passe trop court ou sans chiffre', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    for (const faible of ['court1', 'douzelettressanschiffre']) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers: auth(admin.token),
        payload: { current_password: TEST_PASSWORD, new_password: faible },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('la demande de réinitialisation répond pareil que le compte existe ou non — mais n’écrit qu’au premier', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const connu = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: admin.email } });
    const inconnu = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@test.local' },
    });
    expect(connu.statusCode).toBe(200);
    expect(inconnu.statusCode).toBe(200);
    expect(inconnu.json()).toEqual(connu.json());
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(admin.email);
    expect(mails[0].html).toContain('/reset-password/');
  });

  it('le lien reçu permet de choisir un nouveau mot de passe ; un lien altéré est rejeté', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: admin.email } });
    const token = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(mails[0].html)?.[1];
    expect(token).toBeTruthy();

    // Un jeton dont on change une lettre : la signature ne correspond plus.
    const altere = `${token!.slice(0, -2)}AA`;
    const refus = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: altere, new_password: NOUVEAU_MDP },
    });
    expect(refus.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, new_password: NOUVEAU_MDP },
    });
    expect(ok.statusCode).toBe(200);
    expect((await connexion(admin.email, NOUVEAU_MDP)).statusCode).toBe(200);
  });
});

describe('inscription', () => {
  const profil = {
    first_name: 'Nina',
    last_name: 'Martin',
    phone: '0600000000',
    password: NOUVEAU_MDP,
  };

  it('sans invitation : crée une organisation dont la personne devient admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...profil, email: 'nina@test.local', company_name: 'Nina Propreté', role: 'prestataire' },
    });
    expect(res.statusCode).toBe(201);
    const { user, access_token } = res.json();
    expect(user.password_hash).toBeUndefined();

    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: auth(access_token) })).json();
    // Le rôle demandé est ignoré : on est toujours admin de sa propre org.
    expect(me.role).toBe('admin');
    expect(me.memberships[0].organization_name).toBe('Nina Propreté');
    const org = await app.db('organization').where({ id: me.organization_id }).first();
    expect(org.created_by).toBe(user.id);
  });

  it('refuse un e-mail déjà pris et un mot de passe faible', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const doublon = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...profil, email: admin.email },
    });
    expect(doublon.statusCode).toBe(409);
    const faible = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...profil, email: 'faible@test.local', password: 'court' },
    });
    expect(faible.statusCode).toBe(400);
  });

  it('avec invitation : rejoint l’organisation de l’inviteur avec le rôle invité, et le prévient', async () => {
    const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const jetonAdmin = await enregistrerAppareil(app, admin.id);
    const invitation = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(admin.token),
      payload: { email: 'invitee@test.local', role: 'prestataire' },
    });
    expect(invitation.statusCode).toBe(201);
    expect(mails.at(-1)?.to).toBe('invitee@test.local');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        ...profil,
        // L'adresse saisie est ignorée : c'est celle de l'invitation qui fait foi.
        email: 'autre@test.local',
        invitation_token: invitation.json().token,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe('invitee@test.local');

    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: auth(res.json().access_token) })).json();
    expect(me.role).toBe('prestataire');
    expect(me.organization_id).toBe(organizationId);

    const inv = await app.db('invitation').where({ id: invitation.json().id }).first();
    expect(inv.status).toBe('accepted');

    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({ to: jetonAdmin, title: 'Invitation acceptée' });
    expect(push.messages[0].body).toContain('Nina Martin');
  });

  it('refuse une invitation périmée', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const invitation = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(admin.token),
      payload: { email: 'retard@test.local' },
    });
    await app.db('invitation')
      .where({ id: invitation.json().id })
      .update({ expires_at: new Date(Date.now() - 60_000) });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...profil, email: 'retard@test.local', invitation_token: invitation.json().token },
    });
    expect(res.statusCode).toBe(400);
    expect(await app.db('user').where({ email: 'retard@test.local' })).toHaveLength(0);
  });
});

describe('organisation active', () => {
  it('ne bascule que vers une organisation dont on est membre', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const autreOrg = await createOrganization(app, 'Autre');

    const refus = await app.inject({
      method: 'POST',
      url: '/auth/switch-organization',
      headers: auth(admin.token),
      payload: { organization_id: autreOrg },
    });
    expect(refus.statusCode).toBe(403);

    await app.db('organization_member').insert({ organization_id: autreOrg, user_id: admin.id, role: 'prestataire' });
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/switch-organization',
      headers: auth(admin.token),
      payload: { organization_id: autreOrg },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ active_organization_id: autreOrg, role: 'prestataire' });

    // Le rôle suit l'organisation active : admin ici, simple prestataire là-bas.
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: auth(admin.token) })).json();
    expect(me.role).toBe('prestataire');
    expect(me.organization_id).toBe(autreOrg);
  });

  it('un compte sans organisation active ne voit rien', async () => {
    const { organizationId } = await createOrgWithAdmin(app, 'Conciergerie');
    const presta = await createUser(app, { organizationId, role: 'prestataire' });
    await app.db('organization_member').where({ user_id: presta.id }).del();
    const token = await login(app, presta.email);
    const res = await app.inject({ method: 'GET', url: '/logements', headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });
});
