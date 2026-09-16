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
  clientId: string;
  logementId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const [client] = await app
    .db('client')
    .insert({ organization_id: organizationId, created_by: admin.id, company_name: 'Riviera' })
    .returning('id');
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await app.db('logement').where({ id: logementId }).update({ client_id: client.id });
  return { organizationId, admin, clientId: client.id as string, logementId };
}

/** Une prestation facturable : réalisée, avec un prix client et sa TVA. */
async function menageFacturable(
  ctx: Contexte,
  options: { date?: string; prixHt?: number; tva?: number; linge?: number } = {},
): Promise<string> {
  const id = await createMenage(app, {
    logementId: ctx.logementId,
    organizationId: ctx.organizationId,
    createdBy: ctx.admin.id,
    datePrevue: options.date ?? '2026-07-05',
    status: 'valide',
  });
  await app.db('menage').where({ id }).update({
    client_price_ht: options.prixHt ?? 100,
    client_vat_rate: options.tva ?? 20,
    laundry_included: options.linge !== undefined,
    laundry_client_price_ht: options.linge ?? null,
  });
  return id;
}

describe('génération d’une facture', () => {
  it('reprend les prestations de la période et calcule les totaux', async () => {
    const ctx = await contexte();
    await menageFacturable(ctx, { date: '2026-07-05', prixHt: 100, tva: 20 });
    await menageFacturable(ctx, { date: '2026-07-20', prixHt: 80, tva: 20 });

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, period_start: '2026-07-01', period_end: '2026-07-31' },
    });

    expect(res.statusCode).toBe(201);
    const facture = res.json();
    expect(facture.status).toBe('draft');
    // Une facture brouillon n'a pas encore de numéro : il est légalement attribué
    // à la finalisation, pour que la séquence reste sans trou.
    expect(facture.number).toBeNull();
    expect(Number(facture.total_ht)).toBe(180);
    expect(Number(facture.total_tva)).toBe(36);
    expect(Number(facture.total_ttc)).toBe(216);
  });

  it('facture le linge sur une ligne distincte', async () => {
    const ctx = await contexte();
    const menageId = await menageFacturable(ctx, { prixHt: 100, tva: 20, linge: 15 });

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });

    const lignes = await app.db('invoice_line').where({ invoice_id: res.json().id }).orderBy('position');
    expect(lignes).toHaveLength(2);
    expect(lignes[1].label).toContain('Linge');
    expect(Number(res.json().total_ht)).toBe(115);
    expect(Number(res.json().total_ttc)).toBe(138);
  });

  it('ignore les prestations hors période', async () => {
    const ctx = await contexte();
    await menageFacturable(ctx, { date: '2026-06-28' });
    await menageFacturable(ctx, { date: '2026-07-10' });

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, period_start: '2026-07-01', period_end: '2026-07-31' },
    });
    const lignes = await app.db('invoice_line').where({ invoice_id: res.json().id });
    expect(lignes).toHaveLength(1);
  });

  it('ne facture jamais deux fois la même prestation', async () => {
    const ctx = await contexte();
    const menageId = await menageFacturable(ctx);

    const premiere = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });
    expect(premiere.statusCode).toBe(201);

    // Deuxième tentative sur la même prestation : plus rien de facturable.
    const seconde = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });
    expect(seconde.statusCode).toBe(400);
  });

  it('refacture une prestation dont la facture a été annulée', async () => {
    const ctx = await contexte();
    const menageId = await menageFacturable(ctx);
    const premiere = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });
    await app.inject({
      method: 'PATCH',
      url: `/invoices/${premiere.json().id}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'cancelled' },
    });

    const seconde = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });
    expect(seconde.statusCode).toBe(201);
  });

  it('exclut les prestations annulées', async () => {
    const ctx = await contexte();
    const menageId = await menageFacturable(ctx);
    await app.db('menage').where({ id: menageId }).update({ status: 'annule' });

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, period_start: '2026-07-01', period_end: '2026-07-31' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('est réservée à l’admin', async () => {
    const ctx = await contexte();
    const presta = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    await menageFacturable(ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(presta.token),
      payload: { client_id: ctx.clientId, period_start: '2026-07-01', period_end: '2026-07-31' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('numérotation légale', () => {
  async function facturer(ctx: Contexte, date: string): Promise<string> {
    const menageId = await menageFacturable(ctx, { date });
    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId] },
    });
    return res.json().id;
  }

  it('attribue un numéro séquentiel à la finalisation', async () => {
    const ctx = await contexte();
    const a = await facturer(ctx, '2026-07-01');
    const b = await facturer(ctx, '2026-07-02');

    const premiere = await app.inject({
      method: 'PATCH',
      url: `/invoices/${a}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'sent' },
    });
    const seconde = await app.inject({
      method: 'PATCH',
      url: `/invoices/${b}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'sent' },
    });

    const annee = new Date().getFullYear();
    expect(premiere.json().number).toBe(`${annee}-0001`);
    expect(seconde.json().number).toBe(`${annee}-0002`);
  });

  it('ne renumérote pas une facture déjà numérotée', async () => {
    const ctx = await contexte();
    const id = await facturer(ctx, '2026-07-01');
    const envoyee = await app.inject({
      method: 'PATCH',
      url: `/invoices/${id}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'sent' },
    });
    const payee = await app.inject({
      method: 'PATCH',
      url: `/invoices/${id}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'paid' },
    });
    expect(payee.json().number).toBe(envoyee.json().number);
  });

  it('numérote les devis dans une série distincte', async () => {
    const ctx = await contexte();
    const menageId = await menageFacturable(ctx);
    const devis = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: auth(ctx.admin.token),
      payload: { client_id: ctx.clientId, menage_ids: [menageId], type: 'quote' },
    });
    const accepte = await app.inject({
      method: 'PATCH',
      url: `/invoices/${devis.json().id}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'accepted' },
    });
    expect(accepte.json().number).toBe(`D${new Date().getFullYear()}-0001`);
  });

  it('laisse une facture annulée sans numéro', async () => {
    const ctx = await contexte();
    const id = await facturer(ctx, '2026-07-01');
    const annulee = await app.inject({
      method: 'PATCH',
      url: `/invoices/${id}`,
      headers: auth(ctx.admin.token),
      payload: { status: 'cancelled' },
    });
    // Annuler ne consomme pas de numéro : la séquence resterait trouée.
    expect(annulee.json().number).toBeNull();
  });
});

describe('récap des montants à payer aux prestataires', () => {
  it('additionne les prestations réalisées et non encore payées', async () => {
    const ctx = await contexte();
    const presta = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });

    for (const prix of [55, 45]) {
      const id = await createMenage(app, {
        logementId: ctx.logementId,
        organizationId: ctx.organizationId,
        createdBy: ctx.admin.id,
        prestataireUserId: presta.id,
        status: 'valide',
      });
      await app.db('menage').where({ id }).update({ provider_price: prix });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/invoices/provider-recap',
      headers: auth(ctx.admin.token),
    });
    expect(res.statusCode).toBe(200);
    const ligne = res.json().data.find((r: { user_id: string }) => r.user_id === presta.id);
    expect(ligne).toMatchObject({ n_menages: 2, total: 100 });
  });

  it('retire du récap ce qui vient d’être payé', async () => {
    const ctx = await contexte();
    const presta = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    const menageId = await createMenage(app, {
      logementId: ctx.logementId,
      organizationId: ctx.organizationId,
      createdBy: ctx.admin.id,
      prestataireUserId: presta.id,
      status: 'valide',
    });
    await app.db('menage').where({ id: menageId }).update({ provider_price: 55 });

    await app.inject({
      method: 'POST',
      url: '/invoices/provider-payments',
      headers: auth(ctx.admin.token),
      payload: { menage_ids: [menageId], paid: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/invoices/provider-recap',
      headers: auth(ctx.admin.token),
    });
    expect(res.json().data.find((r: { user_id: string }) => r.user_id === presta.id)).toBeUndefined();
  });
});
