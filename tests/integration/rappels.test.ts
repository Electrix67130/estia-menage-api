import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createUser,
  type TestUser,
} from '../helpers/factories';
import { capturerPush, enregistrerAppareil, type PushCapturee } from '../helpers/push';
import { notifyMenageBedsMissing, notifyMenageRelance, notifyMenageReminder } from '@/lib/push';

/**
 * Les rappels programmés sont déclenchés par `reminder-worker` sur l'heure de
 * Paris, impossible à piloter sans horloge factice. On vérifie ici les
 * notifications qu'il émet, directement par leurs fonctions — destinataires,
 * libellés, préférences — contre la vraie base.
 */

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

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const marie = await createUser(app, { organizationId, role: 'prestataire' });
  const sofia = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Villa Rose' });
  await addLogementMember(app, { logementId, userId: marie.id });
  await addLogementMember(app, { logementId, userId: sofia.id });
  const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, datePrevue: '2026-07-08' });
  return { organizationId, admin, marie, sofia, logementId, menageId };
}

describe('alerte « lits à renseigner »', () => {
  it('prévient les admins de l’organisation, et eux seuls', async () => {
    const { admin, marie, menageId } = await contexte();
    const jetonAdmin = await enregistrerAppareil(app, admin.id);
    await enregistrerAppareil(app, marie.id);

    await notifyMenageBedsMissing(app.db, menageId);

    expect(push.messages.map((m) => m.to)).toEqual([jetonAdmin]);
    expect(push.messages[0].title).toBe('Lits à renseigner');
    expect(push.messages[0].body).toContain('Villa Rose');
    expect(push.messages[0].data).toMatchObject({ menage_id: menageId, type: 'beds_missing' });
  });

  it('respecte la préférence « rappels » coupée', async () => {
    const { admin, menageId } = await contexte();
    await enregistrerAppareil(app, admin.id);
    await app.db('user').where({ id: admin.id }).update({ notification_prefs: { reminders: false } });

    await notifyMenageBedsMissing(app.db, menageId);
    expect(push.messages).toHaveLength(0);
  });
});

describe('relance automatique de la veille', () => {
  it('ne relance que les prestataires du logement qui n’ont pas répondu', async () => {
    const { marie, sofia, menageId } = await contexte();
    await enregistrerAppareil(app, marie.id);
    const jetonSofia = await enregistrerAppareil(app, sofia.id);
    await app.db('menage_response').insert({ menage_id: menageId, user_id: marie.id, status: 'absent' });

    const envoyes = await notifyMenageRelance(app.db, menageId);

    expect(envoyes).toBe(1);
    expect(push.messages.map((m) => m.to)).toEqual([jetonSofia]);
    // Libellé de la veille : « demain » — contrairement à la relance manuelle de l'admin.
    expect(push.messages[0].title).toBe('Ménage à pourvoir demain');
  });

  it('ne fait rien quand tout le monde s’est positionné', async () => {
    const { marie, sofia, menageId } = await contexte();
    await enregistrerAppareil(app, marie.id);
    await enregistrerAppareil(app, sofia.id);
    await app.db('menage_response').insert([
      { menage_id: menageId, user_id: marie.id, status: 'present' },
      { menage_id: menageId, user_id: sofia.id, status: 'absent' },
    ]);
    expect(await notifyMenageRelance(app.db, menageId)).toBe(0);
    expect(push.messages).toHaveLength(0);
  });
});

describe('rappels aux prestataires affectés', () => {
  it('distingue le rappel de la veille du rappel « 2 h avant »', async () => {
    const { marie, menageId } = await contexte();
    const jetonMarie = await enregistrerAppareil(app, marie.id);

    await notifyMenageReminder(app.db, menageId, [marie.id], 'eve');
    await notifyMenageReminder(app.db, menageId, [marie.id], '2h');

    expect(push.messages).toHaveLength(2);
    expect(push.messages.every((m) => m.to === jetonMarie && m.title === 'Rappel ménage')).toBe(true);
    expect(push.messages[0].body).toMatch(/^Demain/);
    expect(push.messages[0].data.type).toBe('reminder_eve');
    expect(push.messages[1].body).toMatch(/2h/);
    expect(push.messages[1].data.type).toBe('reminder_2h');
  });

  it('un prestataire sans appareil enregistré ne bloque pas les autres', async () => {
    const { marie, sofia, menageId } = await contexte();
    const jetonSofia = await enregistrerAppareil(app, sofia.id);
    await notifyMenageReminder(app.db, menageId, [marie.id, sofia.id], 'eve');
    expect(push.messages.map((m) => m.to)).toEqual([jetonSofia]);
  });
});
