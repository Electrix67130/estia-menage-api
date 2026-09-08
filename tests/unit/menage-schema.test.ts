import { describe, expect, it } from 'vitest';
import {
  computeNeedsAttention,
  serializeMenageForRole,
  type MenageRow,
} from '@/modules/menage/menage.schema';

const hier = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};
const demain = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

describe('computeNeedsAttention', () => {
  it('signale un ménage passé que personne n’a pointé', () => {
    expect(computeNeedsAttention({ status: 'a_venir', date_prevue: hier(), arrived_at: null })).toBe(true);
  });

  it('ne signale pas un ménage à venir', () => {
    expect(computeNeedsAttention({ status: 'a_venir', date_prevue: demain(), arrived_at: null })).toBe(false);
  });

  it('ne signale pas un ménage déjà pointé', () => {
    expect(
      computeNeedsAttention({ status: 'a_venir', date_prevue: hier(), arrived_at: '2026-07-01T08:00:00.000Z' }),
    ).toBe(false);
  });

  it('ne signale pas un ménage sorti du statut « à venir »', () => {
    expect(computeNeedsAttention({ status: 'annule', date_prevue: hier(), arrived_at: null })).toBe(false);
  });

  it('ne signale jamais un check-in ou un check-out, où le pointage est optionnel', () => {
    expect(
      computeNeedsAttention({ status: 'a_venir', date_prevue: hier(), arrived_at: null, prestation_type: 'check_in' }),
    ).toBe(false);
  });

  it('accepte une date renvoyée en objet Date par node-pg', () => {
    const veille = new Date();
    veille.setDate(veille.getDate() - 2);
    expect(
      computeNeedsAttention({
        status: 'a_venir',
        date_prevue: veille as unknown as string,
        arrived_at: null,
      }),
    ).toBe(true);
  });
});

describe('serializeMenageForRole', () => {
  const menage = {
    id: 'm1',
    status: 'a_venir',
    date_prevue: demain(),
    arrived_at: null,
    client_price_ht: 120,
    client_vat_rate: 20,
    laundry_client_price_ht: 15,
    provider_price: 60,
    laundry_provider_price: 8,
  } as unknown as MenageRow;

  it("laisse tout passer à l'admin", () => {
    const out = serializeMenageForRole(menage, { isAdmin: true, isPrestataire: false });
    expect(out.client_price_ht).toBe(120);
    expect(out.provider_price).toBe(60);
  });

  it('cache le prix client au prestataire, garde sa propre rémunération', () => {
    const out = serializeMenageForRole(menage, { isAdmin: false, isPrestataire: true });
    expect(out.client_price_ht).toBeUndefined();
    expect(out.client_vat_rate).toBeUndefined();
    expect(out.laundry_client_price_ht).toBeUndefined();
    expect(out.provider_price).toBe(60);
  });

  it('cache aussi le coût prestataire à un simple membre du logement', () => {
    const out = serializeMenageForRole(menage, { isAdmin: false, isPrestataire: false });
    expect(out.client_price_ht).toBeUndefined();
    expect(out.provider_price).toBeUndefined();
    expect(out.laundry_provider_price).toBeUndefined();
  });
});
