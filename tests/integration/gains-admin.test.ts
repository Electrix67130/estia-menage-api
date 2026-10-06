import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createLogement, createMenage, createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

// Les gains côté prestataire (/me/earnings, /users/:id/earnings) sont couverts
// dans gains.test.ts ; ici la vue agrégée de l'admin.

interface Contexte {
  organizationId: string;
  admin: TestUser;
  marie: TestUser;
  sofia: TestUser;
  logementId: string;
  clientId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const marie = await createUser(app, { organizationId, role: 'prestataire' });
  const sofia = await createUser(app, { organizationId, role: 'prestataire' });
  const [client] = await app
    .db('client')
    .insert({ organization_id: organizationId, created_by: admin.id, company_name: 'SCI Horizon' })
    .returning('id');
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await app.db('logement').where({ id: logementId }).update({ client_id: client.id });
  return { organizationId, admin, marie, sofia, logementId, clientId: client.id as string };
}

async function prestationRealisee(
  ctx: Contexte,
  params: { date: string; client: number; presta: number; prestataires?: string[]; status?: string },
): Promise<string> {
  const menageId = await createMenage(app, {
    logementId: ctx.logementId,
    organizationId: ctx.organizationId,
    createdBy: ctx.admin.id,
    datePrevue: params.date,
    status: params.status ?? 'termine',
    prestataireUserId: params.prestataires?.[0] ?? null,
  });
  for (const uid of (params.prestataires ?? []).slice(1)) {
    await app.db('menage_prestataire').insert({ menage_id: menageId, user_id: uid });
  }
  await app.db('menage').where({ id: menageId }).update({ client_price_ht: params.client, provider_price: params.presta });
  return menageId;
}

describe('gains vus par l’admin', () => {
  it('oppose le CA client au coût prestataire et en déduit la marge', async () => {
    const ctx = await contexte();
    await prestationRealisee(ctx, { date: '2026-07-01', client: 90, presta: 55, prestataires: [ctx.marie.id] });
    await prestationRealisee(ctx, { date: '2026-07-02', client: 120, presta: 70, prestataires: [ctx.marie.id] });
    await prestationRealisee(ctx, { date: '2026-07-03', client: 100, presta: 60, prestataires: [ctx.marie.id], status: 'a_venir' });

    const res = await app.inject({ method: 'GET', url: '/admin/earnings', headers: auth(ctx.admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 125, revenue: 210, margin: 85, count: 2, currency: 'EUR' });
    expect(res.json().by_client).toEqual([
      expect.objectContaining({ id: ctx.clientId, name: 'SCI Horizon', total: 125, revenue: 210, margin: 85, count: 2 }),
    ]);
  });

  it('répartit le coût d’une prestation à deux entre ses prestataires', async () => {
    const ctx = await contexte();
    await prestationRealisee(ctx, { date: '2026-07-01', client: 100, presta: 60, prestataires: [ctx.marie.id, ctx.sofia.id] });
    await prestationRealisee(ctx, { date: '2026-07-02', client: 100, presta: 50, prestataires: [ctx.marie.id] });

    const res = await app.inject({ method: 'GET', url: '/admin/earnings', headers: auth(ctx.admin.token) });
    const parPresta = new Map(
      (res.json().by_prestataire as { id: string; total: number; count: number }[]).map((p) => [p.id, p]),
    );
    expect(parPresta.get(ctx.marie.id)).toMatchObject({ total: 80, count: 1.5 });
    expect(parPresta.get(ctx.sofia.id)).toMatchObject({ total: 30, count: 0.5 });
  });

  it('filtre sur une période et sur les seules prestations validées', async () => {
    const ctx = await contexte();
    const validee = await prestationRealisee(ctx, { date: '2026-07-01', client: 90, presta: 55, prestataires: [ctx.marie.id], status: 'valide' });
    await app.db('menage').where({ id: validee }).update({ validated_at: new Date() });
    await prestationRealisee(ctx, { date: '2026-07-15', client: 120, presta: 70, prestataires: [ctx.marie.id] });
    await prestationRealisee(ctx, { date: '2026-08-01', client: 200, presta: 100, prestataires: [ctx.marie.id] });

    const juillet = await app.inject({ method: 'GET', url: '/admin/earnings?from=2026-07-01&to=2026-07-31', headers: auth(ctx.admin.token) });
    expect(juillet.json()).toMatchObject({ count: 2, revenue: 210 });

    const validees = await app.inject({ method: 'GET', url: '/admin/earnings?validated_only=true', headers: auth(ctx.admin.token) });
    expect(validees.json()).toMatchObject({ count: 1, revenue: 90, total: 55 });
  });

  it('est réservé à l’admin et ne traverse pas les organisations', async () => {
    const ctx = await contexte();
    await prestationRealisee(ctx, { date: '2026-07-01', client: 90, presta: 55, prestataires: [ctx.marie.id] });
    const autre = await createOrgWithAdmin(app, 'Voisine');

    expect((await app.inject({ method: 'GET', url: '/admin/earnings', headers: auth(ctx.marie.token) })).statusCode).toBe(403);
    const voisine = await app.inject({ method: 'GET', url: '/admin/earnings', headers: auth(autre.admin.token) });
    expect(voisine.json()).toMatchObject({ count: 0, total: 0, revenue: 0 });
  });
});
