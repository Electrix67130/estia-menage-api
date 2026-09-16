import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  createLogement,
  createMenage,
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
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  return { organizationId, admin, presta, logementId };
}

/** Une prestation réalisée, rémunérée, affectée à quelqu'un. */
async function presta(
  ctx: Contexte,
  options: {
    user?: TestUser;
    prix?: number;
    linge?: number;
    date?: string;
    status?: string;
    valide?: boolean;
    logementId?: string;
  } = {},
): Promise<string> {
  const id = await createMenage(app, {
    logementId: options.logementId ?? ctx.logementId,
    organizationId: ctx.organizationId,
    createdBy: ctx.admin.id,
    prestataireUserId: (options.user ?? ctx.presta).id,
    datePrevue: options.date ?? '2026-07-10',
    status: options.status ?? 'termine',
  });
  await app.db('menage').where({ id }).update({
    provider_price: options.prix ?? 55,
    laundry_included: options.linge !== undefined,
    laundry_provider_price: options.linge ?? null,
    ...(options.valide ? { validated_at: new Date(), validated_by: ctx.admin.id } : {}),
  });
  return id;
}

describe('gains du prestataire', () => {
  it('additionne ses prestations réalisées', async () => {
    const ctx = await contexte();
    await presta(ctx, { prix: 55 });
    await presta(ctx, { prix: 45 });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 100, count: 2, currency: 'EUR' });
  });

  it('ajoute la blanchisserie quand elle est incluse', async () => {
    const ctx = await contexte();
    await presta(ctx, { prix: 55, linge: 8 });
    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json().total).toBe(63);
  });

  it('ignore la blanchisserie non incluse, même tarifée', async () => {
    const ctx = await contexte();
    const id = await presta(ctx, { prix: 55 });
    await app.db('menage').where({ id }).update({ laundry_included: false, laundry_provider_price: 8 });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json().total).toBe(55);
  });

  it('ne compte pas une prestation encore à venir', async () => {
    const ctx = await contexte();
    await presta(ctx, { status: 'a_venir' });
    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json()).toMatchObject({ total: 0, count: 0 });
  });

  it('ne compte pas une prestation annulée', async () => {
    const ctx = await contexte();
    await presta(ctx, { status: 'annule' });
    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json().count).toBe(0);
  });

  it('ne montre pas les gains d’un collègue', async () => {
    const ctx = await contexte();
    const collegue = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    await presta(ctx, { user: collegue, prix: 90 });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json()).toMatchObject({ total: 0, count: 0 });
  });

  it('compte une prestation où il est co-prestataire sans être référent', async () => {
    const ctx = await contexte();
    const referent = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    const menageId = await presta(ctx, { user: referent, prix: 70 });
    // Remplaçant ajouté en renfort : il a fait la prestation, elle doit compter.
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: ctx.presta.id });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json()).toMatchObject({ total: 70, count: 1 });
  });

  it('garde les gains d’un logement archivé après coup', async () => {
    // Archiver un logement ne doit pas effacer une rémunération déjà gagnée.
    const ctx = await contexte();
    await presta(ctx, { prix: 55 });
    await app.db('logement').where({ id: ctx.logementId }).update({ archived_at: new Date() });
    await app.db('menage').where({ logement_id: ctx.logementId }).update({ archived_at: new Date() });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(res.json().total).toBe(55);
  });

  it('filtre sur une période', async () => {
    const ctx = await contexte();
    await presta(ctx, { date: '2026-06-20', prix: 30 });
    await presta(ctx, { date: '2026-07-10', prix: 55 });
    await presta(ctx, { date: '2026-08-02', prix: 40 });

    const res = await app.inject({
      method: 'GET',
      url: '/me/earnings?from=2026-07-01&to=2026-07-31',
      headers: auth(ctx.presta.token),
    });
    expect(res.json()).toMatchObject({ total: 55, count: 1, from: '2026-07-01', to: '2026-07-31' });
  });

  it('restreint aux prestations validées sur demande', async () => {
    const ctx = await contexte();
    await presta(ctx, { prix: 55, status: 'termine' });
    await presta(ctx, { prix: 45, status: 'valide', valide: true });

    const tout = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    expect(tout.json().total).toBe(100);

    const valides = await app.inject({
      method: 'GET',
      url: '/me/earnings?validated_only=true',
      headers: auth(ctx.presta.token),
    });
    expect(valides.json()).toMatchObject({ total: 45, count: 1 });
  });

  it('détaille chaque prestation avec son sous-total', async () => {
    const ctx = await contexte();
    await presta(ctx, { prix: 55, linge: 8 });

    const res = await app.inject({ method: 'GET', url: '/me/earnings', headers: auth(ctx.presta.token) });
    const ligne = res.json().items[0];
    expect(ligne).toMatchObject({ subtotal: 63, laundry_included: true });
    expect(ligne.logement_name).toBe('Logement de test');
  });
});

describe('gains vus par l’admin', () => {
  it('peut consulter ceux d’un prestataire', async () => {
    const ctx = await contexte();
    await presta(ctx, { prix: 55 });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${ctx.presta.id}/earnings`,
      headers: auth(ctx.admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(55);
  });

  it('reste fermé à un prestataire qui viserait un collègue', async () => {
    const ctx = await contexte();
    const collegue = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${collegue.id}/earnings`,
      headers: auth(ctx.presta.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('ne traverse pas les organisations', async () => {
    const ctx = await contexte();
    const autre = await createOrgWithAdmin(app, 'Conciergerie B');
    await presta(ctx, { prix: 55 });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${ctx.presta.id}/earnings`,
      headers: auth(autre.admin.token),
    });
    // L'admin d'une autre org ne voit rien de ce prestataire.
    expect([403, 404].includes(res.statusCode) || res.json().total === 0).toBe(true);
  });
});
