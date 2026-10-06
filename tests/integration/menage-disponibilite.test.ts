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
  marie: TestUser;
  sofia: TestUser;
  thomas: TestUser;
  logementId: string;
}

/** Un logement avec trois prestataires membres, aucune prestation encore. */
async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const marie = await createUser(app, { organizationId, role: 'prestataire' });
  const sofia = await createUser(app, { organizationId, role: 'prestataire' });
  const thomas = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  for (const u of [marie, sofia, thomas]) await addLogementMember(app, { logementId, userId: u.id });
  return { organizationId, admin, marie, sofia, thomas, logementId };
}

async function voter(menageId: string, userId: string, status: 'present' | 'absent'): Promise<void> {
  await app.db('menage_response').insert({ menage_id: menageId, user_id: userId, status });
}

async function lister(token: string, query = ''): Promise<Array<Record<string, unknown>>> {
  const res = await app.inject({ method: 'GET', url: `/menages${query}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

describe('disponibilité des prestataires dans la liste admin', () => {
  it('compte les présents, les absents et les membres pouvant répondre', async () => {
    const { organizationId, admin, marie, sofia, thomas, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    await voter(menageId, marie.id, 'present');
    await voter(menageId, sofia.id, 'present');
    await voter(menageId, thomas.id, 'absent');

    const [m] = await lister(admin.token);
    expect(m.id).toBe(menageId);
    expect(m.present_count).toBe(2);
    expect(m.absent_count).toBe(1);
    expect(m.member_prestataire_count).toBe(3);
  });

  it('filtre par disponibilité : quelqu’un de dispo / personne / aucune réponse', async () => {
    const { organizationId, admin, marie, thomas, logementId } = await contexte();
    const base = { logementId, organizationId, createdBy: admin.id };
    const dispo = await createMenage(app, { ...base, datePrevue: '2026-07-01' });
    const personne = await createMenage(app, { ...base, datePrevue: '2026-07-02' });
    const silence = await createMenage(app, { ...base, datePrevue: '2026-07-03' });
    await voter(dispo, marie.id, 'present');
    await voter(dispo, thomas.id, 'absent');
    await voter(personne, thomas.id, 'absent');

    const ids = async (q: string) => (await lister(admin.token, q)).map((m) => m.id);
    expect(await ids('?availability=available')).toEqual([dispo]);
    expect(await ids('?availability=unavailable')).toEqual([personne]);
    expect(await ids('?availability=no_response')).toEqual([silence]);
    expect(await ids('')).toHaveLength(3);
  });

  it('expose le vote de chaque prestataire éligible', async () => {
    const { organizationId, admin, marie, sofia, thomas, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    await voter(menageId, marie.id, 'present');
    await voter(menageId, thomas.id, 'absent');

    const res = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/eligible-prestataires`,
      headers: auth(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const parId = new Map(
      (res.json().data as Array<{ id: string; response_status: string | null; responded_at: string | null }>).map(
        (p) => [p.id, p],
      ),
    );
    expect(parId.get(marie.id)?.response_status).toBe('present');
    expect(parId.get(marie.id)?.responded_at).toBeTruthy();
    expect(parId.get(sofia.id)?.response_status).toBeNull();
    expect(parId.get(thomas.id)?.response_status).toBe('absent');
  });
});

describe('relance manuelle des prestataires sans réponse', () => {
  it('ne pousse qu’à ceux qui n’ont pas répondu et renvoie leur nombre', async () => {
    const { organizationId, admin, marie, sofia, thomas, logementId } = await contexte();
    const jetonSofia = await enregistrerAppareil(app, sofia.id);
    const jetonThomas = await enregistrerAppareil(app, thomas.id);
    await enregistrerAppareil(app, marie.id);
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    await voter(menageId, marie.id, 'present');

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/relance`,
      headers: auth(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: 2 });

    await laisserPartirLesPush();
    const destinataires = push.messages.map((m) => m.to).sort();
    expect(destinataires).toEqual([jetonSofia, jetonThomas].sort());
    expect(push.messages[0].title).toBe('Ménage à pourvoir');
    expect(push.messages[0].data).toMatchObject({ menage_id: menageId, type: 'relance' });
  });

  it('est réservée à l’admin et refusée sur une prestation déjà affectée', async () => {
    const { organizationId, admin, marie, logementId } = await contexte();
    const libre = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    const affectee = await createMenage(app, {
      logementId,
      organizationId,
      createdBy: admin.id,
      prestataireUserId: marie.id,
      datePrevue: '2026-07-02',
    });

    const parPresta = await app.inject({ method: 'POST', url: `/menages/${libre}/relance`, headers: auth(marie.token) });
    expect(parPresta.statusCode).toBe(403);

    const dejaAffectee = await app.inject({
      method: 'POST',
      url: `/menages/${affectee}/relance`,
      headers: auth(admin.token),
    });
    expect(dejaAffectee.statusCode).toBe(400);
    expect(push.messages).toHaveLength(0);
  });
});
