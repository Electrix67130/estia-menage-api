import { describe, expect, it } from 'vitest';
import { toHhmm, todayYmd, toYmd } from '@/lib/date';

describe('toYmd', () => {
  it('laisse passer une chaîne déjà au bon format', () => {
    expect(toYmd('2026-07-01')).toBe('2026-07-01');
  });

  it('tronque un timestamp ISO au jour', () => {
    expect(toYmd('2026-07-01T09:30:00.000Z')).toBe('2026-07-01');
  });

  it('lit un objet Date en heure locale, pas en UTC', () => {
    // C'est exactement ce que rend node-pg pour une colonne DATE : minuit local.
    // Lu en UTC depuis Paris, « 2026-07-01 » devenait « 2026-06-30 » — un jour
    // de moins sur chaque comparaison de date.
    const minuitLocal = new Date(2026, 6, 1, 0, 0, 0);
    expect(toYmd(minuitLocal)).toBe('2026-07-01');
  });

  it('tient aussi en hiver, quand le décalage change', () => {
    expect(toYmd(new Date(2026, 0, 15, 0, 0, 0))).toBe('2026-01-15');
  });

  it('rend null sur une valeur absente', () => {
    expect(toYmd(null)).toBeNull();
    expect(toYmd(undefined)).toBeNull();
  });
});

describe('todayYmd', () => {
  it('donne le jour courant en heure locale', () => {
    const maintenant = new Date();
    const attendu = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(
      maintenant.getDate(),
    ).padStart(2, '0')}`;
    expect(todayYmd()).toBe(attendu);
  });
});

describe('toHhmm', () => {
  it('ramène un TIME PostgreSQL à HH:MM', () => {
    // « 09:00:00 » côté base face à « 09:00 » envoyé par le client : comparés
    // bruts, ils paraissaient toujours différents.
    expect(toHhmm('09:00:00')).toBe('09:00');
    expect(toHhmm('09:00')).toBe('09:00');
  });

  it('rend null sur une valeur absente', () => {
    expect(toHhmm(null)).toBeNull();
  });
});
