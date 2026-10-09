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

/** Réglages des notifications : interrupteur général, catégories, réglage par logement. */

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
  logementId: string;
  menageId: string;
  jetonAdmin: string;
  jetonPresta: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Villa des Oliviers' });
  await addLogementMember(app, { logementId, userId: presta.id });
  const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, prestataireUserId: presta.id });
  const jetonAdmin = await enregistrerAppareil(app, admin.id);
  const jetonPresta = await enregistrerAppareil(app, presta.id);
  return { organizationId, admin, presta, logementId, menageId, jetonAdmin, jetonPresta };
}

const preferer = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/notification-preferences', headers: auth(token), payload });

const regler = (token: string, logementId: string, level: string) =>
  app.inject({
    method: 'PUT',
    url: `/notification-preferences/logements/${logementId}`,
    headers: auth(token),
    payload: { level },
  });

const commenter = (token: string, menageId: string, content: string, mentioned_user_ids?: string[]) =>
  app.inject({ method: 'POST', url: '/comments', headers: auth(token), payload: { menage_id: menageId, content, mentioned_user_ids } });

const annuler = (ctx: Contexte) =>
  app.inject({ method: 'PATCH', url: `/menages/${ctx.menageId}`, headers: auth(ctx.admin.token), payload: { status: 'annule' } });

const recusPar = (jeton: string) => push.messages.filter((m) => m.to === jeton).map((m) => m.data.type);

describe('lecture et écriture des préférences', () => {
  it('tout est actif par défaut ; les catégories restent à plat pour les apps déjà installées', async () => {
    const { presta } = await contexte();
    const res = await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(presta.token) });
    expect(res.json()).toMatchObject({ push_enabled: true, comments: true, mentions: true, reports: true, logements: [] });

    // Ancienne forme de la modification, toujours acceptée.
    expect((await preferer(presta.token, { key: 'comments', enabled: false })).statusCode).toBe(200);
    expect((await preferer(presta.token, { push_enabled: false })).statusCode).toBe(200);
    const apres = await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(presta.token) });
    expect(apres.json()).toMatchObject({ push_enabled: false, comments: false, mentions: true });
  });

  it('régler un logement le fait apparaître dans la liste ; « tout » l’en retire ; un logement d’ailleurs est introuvable', async () => {
    const { presta, logementId } = await contexte();
    await regler(presta.token, logementId, 'important');
    let prefs = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(presta.token) })).json();
    expect(prefs.logements).toEqual([{ logement_id: logementId, logement_name: 'Villa des Oliviers', level: 'important' }]);

    await regler(presta.token, logementId, 'all');
    prefs = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(presta.token) })).json();
    expect(prefs.logements).toEqual([]);

    const { organizationId: autreOrg, admin: autreAdmin } = await createOrgWithAdmin(app, 'Autre');
    const ailleurs = await createLogement(app, { organizationId: autreOrg, createdBy: autreAdmin.id });
    expect((await regler(presta.token, ailleurs, 'none')).statusCode).toBe(404);
  });
});

describe('effet sur les notifications', () => {
  it('l’interrupteur général coupe tout, mentions comprises', async () => {
    const ctx = await contexte();
    await preferer(ctx.admin.token, { push_enabled: false });

    await commenter(ctx.presta.token, ctx.menageId, 'Linge manquant');
    await commenter(ctx.presta.token, ctx.menageId, '@Test admin regarde', [ctx.admin.id]);
    await laisserPartirLesPush();
    expect(recusPar(ctx.jetonAdmin)).toEqual([]);
  });

  it('couper les commentaires laisse passer les mentions ; couper les mentions les arrête', async () => {
    const ctx = await contexte();
    await preferer(ctx.admin.token, { key: 'comments', enabled: false });
    await commenter(ctx.presta.token, ctx.menageId, 'Sans mention');
    await commenter(ctx.presta.token, ctx.menageId, '@Test admin', [ctx.admin.id]);
    await laisserPartirLesPush();
    expect(recusPar(ctx.jetonAdmin)).toEqual(['comment_mention']);

    push.messages.length = 0;
    await preferer(ctx.admin.token, { key: 'mentions', enabled: false });
    await commenter(ctx.presta.token, ctx.menageId, '@Test admin encore', [ctx.admin.id]);
    await laisserPartirLesPush();
    expect(recusPar(ctx.jetonAdmin)).toEqual([]);
  });

  it('un logement sur « l’important » garde mentions et affectations, coupe les commentaires', async () => {
    const ctx = await contexte();
    await regler(ctx.admin.token, ctx.logementId, 'important');
    await regler(ctx.presta.token, ctx.logementId, 'important');

    await commenter(ctx.presta.token, ctx.menageId, 'Juste un commentaire');
    await commenter(ctx.presta.token, ctx.menageId, '@Test admin', [ctx.admin.id]);
    await annuler(ctx);
    await laisserPartirLesPush();

    expect(recusPar(ctx.jetonAdmin)).toEqual(['comment_mention']);
    expect(recusPar(ctx.jetonPresta)).toEqual(['cancelled']);
  });

  it('un logement sur « rien » ne prévient plus de rien, les autres logements si', async () => {
    const ctx = await contexte();
    await regler(ctx.presta.token, ctx.logementId, 'none');
    const autreLogement = await createLogement(app, { organizationId: ctx.organizationId, createdBy: ctx.admin.id });
    const autreMenage = await createMenage(app, {
      logementId: autreLogement,
      organizationId: ctx.organizationId,
      createdBy: ctx.admin.id,
      prestataireUserId: ctx.presta.id,
    });

    await annuler(ctx);
    await app.inject({ method: 'PATCH', url: `/menages/${autreMenage}`, headers: auth(ctx.admin.token), payload: { status: 'annule' } });
    await laisserPartirLesPush();

    const recues = push.messages.filter((m) => m.to === ctx.jetonPresta);
    expect(recues.map((m) => m.data.menage_id)).toEqual([autreMenage]);
  });
});
