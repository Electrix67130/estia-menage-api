import { describe, expect, it } from 'vitest';
import { bareZip, candidateCountries, chDetailMatchesCity } from '@/lib/geocode';

describe('geocode — choix du pays d’après le code postal', () => {
  it('5 chiffres ou rien : France (BAN)', () => {
    expect(candidateCountries('54000')).toEqual(['FR']);
    expect(candidateCountries(null)).toEqual(['FR']);
    expect(candidateCountries('')).toEqual(['FR']);
  });

  it('« L-1234 » : Luxembourg seul', () => {
    expect(candidateCountries('L-1610')).toEqual(['LU']);
    expect(candidateCountries('l1610')).toEqual(['LU']);
  });

  it('4 chiffres : Suisse, puis Luxembourg, puis Belgique', () => {
    expect(candidateCountries('1204')).toEqual(['CH', 'LU', 'BE']);
  });

  it('le code postal comparé perd son préfixe pays', () => {
    expect(bareZip('L-4221')).toBe('4221');
    expect(bareZip(' 1204 ')).toBe('1204');
  });
});

describe('geocode — Suisse : la ville doit correspondre', () => {
  it('accents et translittération allemande', () => {
    expect(chDetailMatchesCity('rue du rhone 12 1204 geneve 6621 geneve ch ge', 'Genève')).toBe(true);
    expect(chDetailMatchesCity('bahnhofstrasse 3 8001 zuerich 261 zuerich ch zh', 'Zürich')).toBe(true);
  });

  it('même code postal, autre pays : rejeté (1000 = Lausanne et Bruxelles)', () => {
    expect(chDetailMatchesCity('rue neuve 12 1000 lausanne 5586 lausanne ch vd', 'Bruxelles')).toBe(false);
  });
});
