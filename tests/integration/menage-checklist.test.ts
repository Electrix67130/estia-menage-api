import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createOrgWithAdmin,
  createUser,
  type TestUser,
} from '../helpers/factories';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

interface Contexte {
  organizationId: string;
  admin: TestUser;
  presta: TestUser;
  logementId: string;
  menageId: string;
}

/**
 * Un logement doté d'un modèle de checklist, puis une prestation créée **par
 * l'API** : c'est la création qui doit engendrer la checklist, l'insérer à la
 * main ne testerait rien.
 */
async function contexteAvecTemplate(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await addLogementMember(app, { logementId, userId: presta.id });

  const [section] = await app
    .db('logement_check_template_section')
    .insert({ logement_id: logementId, label: 'Cuisine', icon: '🍽️', position: 0 })
    .returning('id');
  await app.db('logement_check_template_item').insert([
    { section_id: section.id, label: 'Vider le lave-vaisselle', position: 0 },
    { section_id: section.id, label: 'Nettoyer les plaques', position: 1 },
  ]);

  const cree = await app.inject({
    method: 'POST',
    url: '/menages',
    headers: auth(admin.token),
    payload: { logement_id: logementId, date_prevue: '2026-07-01', prestataire_user_id: presta.id },
  });
  if (cree.statusCode !== 201) throw new Error(`Création impossible : ${cree.statusCode} ${cree.body}`);

  return { organizationId, admin, presta, logementId, menageId: cree.json().id };
}

describe('génération de la checklist', () => {
  it('reprend le modèle du logement à la création de la prestation', async () => {
    const { admin, menageId } = await contexteAvecTemplate();

    const res = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(admin.token),
    });

    expect(res.statusCode).toBe(200);
    const arbre = res.json();
    expect(arbre).toHaveLength(1);
    expect(arbre[0]).toMatchObject({ section_label: 'Cuisine', icon: '🍽️' });
    expect(arbre[0].items.map((i: { item_label: string }) => i.item_label)).toEqual([
      'Vider le lave-vaisselle',
      'Nettoyer les plaques',
    ]);
  });

  it('part avec tous les items à cocher', async () => {
    const { admin, menageId } = await contexteAvecTemplate();
    const res = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(admin.token),
    });
    // « Coché » n'est pas un booléen en base : c'est `validated_at` qui fait foi.
    expect(res.json()[0].items.every((i: { validated_at: string | null }) => i.validated_at === null)).toBe(true);
  });
});

describe('lecture de la checklist', () => {
  it('est ouverte au prestataire affecté', async () => {
    const { presta, menageId } = await contexteAvecTemplate();
    const res = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(presta.token),
    });
    expect(res.statusCode).toBe(200);
  });

  it('est fermée à un prestataire étranger au logement', async () => {
    const { organizationId, menageId } = await contexteAvecTemplate();
    const etranger = await createUser(app, { organizationId, role: 'prestataire' });
    const res = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(etranger.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('cocher la checklist', () => {
  it('mémorise qui a coché, et quand', async () => {
    const { presta, menageId } = await contexteAvecTemplate();
    const arbre = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(presta.token),
    });
    const itemId = arbre.json()[0].items[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/menage-check-items/${itemId}/toggle`,
      headers: auth(presta.token),
      payload: { validated: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().validated_by).toBe(presta.id);
    expect(res.json().validated_at).not.toBeNull();
  });

  it('accepte un commentaire d’étape', async () => {
    const { presta, menageId } = await contexteAvecTemplate();
    const arbre = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(presta.token),
    });
    const itemId = arbre.json()[0].items[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/menage-check-items/${itemId}/toggle`,
      headers: auth(presta.token),
      payload: { validated: true, comment: 'Plaque tachée, signalée' },
    });
    expect(res.json().comment).toBe('Plaque tachée, signalée');
  });

  it('efface le validateur quand on décoche', async () => {
    const { presta, menageId } = await contexteAvecTemplate();
    const arbre = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(presta.token),
    });
    const itemId = arbre.json()[0].items[0].id;

    await app.inject({
      method: 'POST',
      url: `/menage-check-items/${itemId}/toggle`,
      headers: auth(presta.token),
      payload: { validated: true },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/menage-check-items/${itemId}/toggle`,
      headers: auth(presta.token),
      payload: { validated: false },
    });

    expect(res.json().validated_at).toBeNull();
    expect(res.json().validated_by).toBeNull();
  });

  it('reste fermée à un prestataire étranger au logement', async () => {
    const { organizationId, admin, menageId } = await contexteAvecTemplate();
    const etranger = await createUser(app, { organizationId, role: 'prestataire' });
    const arbre = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(admin.token),
    });
    const itemId = arbre.json()[0].items[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/menage-check-items/${itemId}/toggle`,
      headers: auth(etranger.token),
      payload: { validated: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('coche toute une section d’un coup', async () => {
    const { presta, menageId } = await contexteAvecTemplate();
    const arbre = await app.inject({
      method: 'GET',
      url: `/menages/${menageId}/check`,
      headers: auth(presta.token),
    });
    const sectionId = arbre.json()[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/menage-check-sections/${sectionId}/toggle-all`,
      headers: auth(presta.token),
      payload: { validated: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].items.every((i: { validated_at: string | null }) => i.validated_at !== null)).toBe(true);
  });

  it('coche toute la checklist d’un coup', async () => {
    const { presta, menageId } = await contexteAvecTemplate();

    const res = await app.inject({
      method: 'POST',
      url: `/menages/${menageId}/check/toggle-all`,
      headers: auth(presta.token),
      payload: { validated: true },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json().flatMap((s: { items: { validated_at: string | null }[] }) => s.items);
    expect(items.every((i: { validated_at: string | null }) => i.validated_at !== null)).toBe(true);
  });
});
