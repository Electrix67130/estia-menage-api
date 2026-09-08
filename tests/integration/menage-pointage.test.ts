import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

// Pas de `await` au niveau du module : le projet compile en CommonJS, et
// `tsc --noEmit` (joué par la CI) le refuse.
let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

/** Preuve de présence attendue d'un ménage : photo géolocalisée. */
const preuve = {
  photo_url: 'https://api.estia-clean-connect.fr/files/preuve.jpg',
  lat: 43.6,
  lng: 7.02,
};

interface Contexte {
  organizationId: string;
  admin: TestUser;
  presta: TestUser;
  logementId: string;
  menageId: string;
}

async function contexte(prestationType: 'menage' | 'check_in' = 'menage'): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await addLogementMember(app, { logementId, userId: presta.id });
  const menageId = await createMenage(app, {
    logementId,
    organizationId,
    createdBy: admin.id,
    prestataireUserId: presta.id,
  });
  if (prestationType !== 'menage') {
    await app.db('menage').where({ id: menageId }).update({ prestation_type: prestationType });
  }
  return { organizationId, admin, presta, logementId, menageId };
}

describe('pointage d’arrivée', () => {
  it('passe la prestation en cours et horodate l’arrivée', async () => {
    const { presta, menageId } = await contexte();

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: preuve,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'en_cours' });
    expect(res.json().arrived_at).not.toBeNull();
  });

  it('n’est ouvert qu’au prestataire affecté', async () => {
    const { organizationId, admin, logementId, menageId } = await contexte();
    const autre = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: autre.id });

    const parUnAutre = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(autre.token),
      payload: preuve,
    });
    expect(parUnAutre.statusCode).toBe(403);

    // Même l'admin ne pointe pas à la place du prestataire : le pointage est une
    // preuve de présence, pas une écriture administrative.
    const parAdmin = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(admin.token),
      payload: preuve,
    });
    expect(parAdmin.statusCode).toBe(403);
  });

  it('exige la photo géolocalisée sur un ménage', async () => {
    const { presta, menageId } = await contexte();
    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepte un pointage sans photo sur un check-in', async () => {
    // Décision produit : pas d'exigence de preuve géolocalisée hors ménage.
    const { presta, menageId } = await contexte('check_in');
    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('en_cours');
  });

  it('retient l’heure réelle fournie par le client, pas celle de la synchro', async () => {
    // File d'attente hors ligne : le pointage a pu attendre le réseau des heures.
    const { presta, menageId } = await contexte();
    const heureReelle = '2026-07-01T06:30:00.000Z';

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: { ...preuve, arrived_at: heureReelle },
    });

    expect(new Date(res.json().arrived_at).toISOString()).toBe(heureReelle);
  });

  it('enregistre la déclaration voyageurs faite au pointage', async () => {
    const { presta, menageId } = await contexte();
    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: { ...preuve, traveler_rating: 2, has_degradation: true, degradation_note: 'Vitre fêlée' },
    });

    expect(res.json()).toMatchObject({
      traveler_rating: 2,
      has_degradation: true,
      degradation_note: 'Vitre fêlée',
    });
  });
});

describe('pointage de départ', () => {
  it('termine la prestation et fixe la date de réalisation au jour réel', async () => {
    const { presta, menageId } = await contexte();
    await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: preuve,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/departure`,
      headers: auth(presta.token),
      payload: { ...preuve, departed_at: '2026-07-01T11:15:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('termine');
    // La date de réalisation suit le départ réel, pas le jour de l'envoi.
    // Lue en base et formatée par PostgreSQL : `date_realisation` est une
    // colonne DATE, que node-pg rend en objet Date — sérialisée en JSON elle
    // repasse en UTC et paraît reculer d'un jour depuis Paris.
    const [{ jour }] = await app.db('menage')
      .where({ id: menageId })
      .select(app.db.raw("to_char(date_realisation, 'YYYY-MM-DD') as jour"));
    expect(jour).toBe('2026-07-01');
  });

  it('reste fermé à un prestataire non affecté', async () => {
    const { organizationId, logementId, menageId } = await contexte();
    const autre = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: autre.id });

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/departure`,
      headers: auth(autre.token),
      payload: preuve,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('déclaration voyageurs a posteriori', () => {
  it('est modifiable par l’admin après le pointage', async () => {
    const { admin, presta, menageId } = await contexte();
    await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/arrival`,
      headers: auth(presta.token),
      payload: { ...preuve, traveler_rating: 5 },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/declaration`,
      headers: auth(admin.token),
      payload: { traveler_rating: 3, has_degradation: true, degradation_note: 'Constaté après coup' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ traveler_rating: 3, has_degradation: true });
  });

  it('refuse un membre du logement sans droit d’édition', async () => {
    const { organizationId, logementId, menageId } = await contexte();
    const spectateur = await createUser(app, { organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId, userId: spectateur.id });

    const res = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/declaration`,
      headers: auth(spectateur.token),
      payload: { traveler_rating: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('validation du rapport', () => {
  it('clôture la prestation et retient le prix prévu', async () => {
    const { admin, menageId } = await contexte();
    await app.db('menage').where({ id: menageId }).update({ prix_prevu: 80 });

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/validate`,
      headers: auth(admin.token),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'valide', validated_by: admin.id });
    expect(Number(res.json().validated_price)).toBe(80);
  });

  it('accepte un prix corrigé à la validation', async () => {
    const { admin, menageId } = await contexte();
    await app.db('menage').where({ id: menageId }).update({ prix_prevu: 80 });

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/validate`,
      headers: auth(admin.token),
      payload: { price: 95 },
    });
    expect(Number(res.json().validated_price)).toBe(95);
  });

  it('n’est pas ouverte au prestataire, même affecté', async () => {
    const { presta, menageId } = await contexte();
    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/validate`,
      headers: auth(presta.token),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('sort la prestation de la liste active', async () => {
    const { admin, menageId } = await contexte();
    await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/validate`,
      headers: auth(admin.token),
      payload: {},
    });

    const active = await app.inject({ method: 'GET', url: '/menages?closed=false', headers: auth(admin.token) });
    expect(active.json().data).toHaveLength(0);

    const historique = await app.inject({ method: 'GET', url: '/menages?closed=true', headers: auth(admin.token) });
    expect(historique.json().data).toHaveLength(1);
  });
});
