import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_URL_WINDOW, signFields, signFileUrl, signUrlsInList } from '@/lib/sign-url';

const APP_URL = process.env.APP_URL as string;

function jeton(url: string): { f: string; e: number; s: string } {
  const t = new URL(url).searchParams.get('t') as string;
  return JSON.parse(Buffer.from(t, 'base64url').toString()) as { f: string; e: number; s: string };
}

afterEach(() => vi.useRealTimers());

describe('signFileUrl', () => {
  it('produit la même URL pendant toute la fenêtre — le cache client peut la réutiliser', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'));
    const a = signFileUrl(`${APP_URL}/files/photo.jpg`);
    vi.setSystemTime(new Date('2026-07-01T17:30:00Z'));
    const b = signFileUrl(`${APP_URL}/files/photo.jpg`);
    expect(b).toBe(a);
  });

  it('change d’URL quand on change de fenêtre, et reste valide au moins une fenêtre entière', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T23:59:00Z'));
    const avant = signFileUrl(`${APP_URL}/files/photo.jpg`);
    // Jamais d'expiration juste après émission : au moins une fenêtre complète.
    expect(jeton(avant).e - Date.now()).toBeGreaterThanOrEqual(FILE_URL_WINDOW.short);

    vi.setSystemTime(new Date('2026-07-02T00:01:00Z'));
    const apres = signFileUrl(`${APP_URL}/files/photo.jpg`);
    expect(apres).not.toBe(avant);
  });

  it('re-signer une URL déjà signée ne garde pas l’ancien jeton dans le nom du fichier', () => {
    const une = signFileUrl(`${APP_URL}/files/photo.jpg`);
    const deux = signFileUrl(une);
    expect(jeton(deux).f).toBe('photo.jpg');
    expect(deux).toBe(une);
  });

  it('signe sur le nom de fichier seul, et pointe vers l’API courante', () => {
    const url = signFileUrl('https://ancien-domaine.test/files/photo.jpg');
    expect(url.startsWith(`${APP_URL}/files/photo.jpg?t=`)).toBe(true);
    expect(jeton(url).s).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('signFields / signUrlsInList', () => {
  it('ne signe que les champs demandés qui pointent vers /files/', () => {
    const item = {
      avatar_url: `${APP_URL}/files/avatar.jpg`,
      url: 'https://cdn.externe/photo.jpg',
      caption: '/files/pas-une-url',
    };
    const signe = signFields(item, ['avatar_url', 'url']);
    expect(signe.avatar_url).toContain('?t=');
    expect(signe.url).toBe('https://cdn.externe/photo.jpg');
    // Champ non listé : jamais touché, même s'il ressemble à un chemin.
    expect(signe.caption).toBe('/files/pas-une-url');
    // L'original n'est pas modifié.
    expect(item.avatar_url).not.toContain('?t=');
  });

  it('donne une fenêtre longue aux avatars et couvertures, par défaut sur url/thumbnail_url', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'));
    const [photo] = signUrlsInList([{ url: `${APP_URL}/files/a.jpg`, thumbnail_url: `${APP_URL}/files/a_thumb.jpg` }]);
    const profil = signFields({ avatar_url: `${APP_URL}/files/b.jpg` }, ['avatar_url']);
    expect(jeton(photo.url).e - Date.now()).toBeLessThanOrEqual(2 * FILE_URL_WINDOW.short);
    expect(jeton(photo.thumbnail_url).f).toBe('a_thumb.jpg');
    expect(jeton(profil.avatar_url).e - Date.now()).toBeLessThanOrEqual(2 * FILE_URL_WINDOW.long);
    expect(jeton(profil.avatar_url).e - Date.now()).toBeGreaterThanOrEqual(FILE_URL_WINDOW.long);
  });

  it('laisse passer les valeurs nulles ou non textuelles', () => {
    const signe = signFields({ url: null, thumbnail_url: undefined, n: 3 }, ['url', 'thumbnail_url', 'n']);
    expect(signe).toEqual({ url: null, thumbnail_url: undefined, n: 3 });
  });
});
