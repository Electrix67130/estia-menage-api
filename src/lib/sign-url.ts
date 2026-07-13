import { createHmac } from 'crypto';
import env from '@/config/env';

/**
 * Fenêtres d'expiration des URLs signées `/files`.
 *
 * L'expiration est **arrondie à la fenêtre courante** (`bucketedExpiry`) : un
 * même fichier produit donc la MÊME URL pendant toute la fenêtre. Sans ça, le
 * token changeait à chaque réponse API → l'URL changeait → le cache client
 * (navigateur, `<Image>` RN, qui indexent par URL complète) était invalidé →
 * l'image était re-téléchargée à chaque affichage. Avec une URL stable, le
 * cache reprend son rôle.
 */
export const FILE_URL_WINDOW = {
  /** Images peu sensibles (avatar, couverture de logement) : URL stable 24 h. */
  long: 24 * 60 * 60 * 1000,
  /** Défaut, incl. photos d'intervention (plus sensibles) : URL stable 1 h. */
  short: 60 * 60 * 1000,
} as const;

/** Champs dont l'URL peut vivre longtemps (contenu non confidentiel). */
const LONG_WINDOW_FIELDS = new Set([
  'avatar_url',
  'avatar_thumbnail_url',
  'cover_photo_url',
  'cover_photo_thumbnail_url',
  'prestataire_avatar_url',
  'prestataire_avatar_thumbnail_url',
]);

/**
 * Expiration arrondie à la fenêtre : identique pour tous les appels d'une même
 * fenêtre (URL stable), et toujours valide entre 1 et 2 fenêtres (jamais
 * d'expiration juste après émission).
 */
function bucketedExpiry(windowMs: number): number {
  const bucket = Math.floor(Date.now() / windowMs);
  return (bucket + 2) * windowMs;
}

/** Generate a signed URL for a file path like /files/abc-123.pdf */
export function signFileUrl(fileUrl: string, windowMs: number = FILE_URL_WINDOW.short): string {
  // Retire une éventuelle query (`?t=...`) : signature idempotente même si l'URL
  // stockée contient déjà un token (cas d'un champ re-persisté depuis une URL
  // déjà signée). Sans ça, le nom de fichier inclurait le token et l'URL
  // re-signée serait invalide → 403.
  const filename = fileUrl.split('/').pop()?.split('?')[0];
  if (!filename) return fileUrl;

  const expires = bucketedExpiry(windowMs);
  const data = `${filename}:${expires}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({ f: filename, e: expires, s: signature })).toString('base64url');

  return `${env.APP_URL}/files/${filename}?t=${token}`;
}

/** Sign the given fields of a single object if they point to an internal /files/ URL. */
export function signFields<T extends Record<string, unknown>>(item: T, fields: string[]): T {
  const signed = { ...item };
  for (const field of fields) {
    const val = signed[field];
    if (typeof val === 'string' && val.includes('/files/')) {
      const windowMs = LONG_WINDOW_FIELDS.has(field) ? FILE_URL_WINDOW.long : FILE_URL_WINDOW.short;
      (signed as Record<string, unknown>)[field] = signFileUrl(val, windowMs);
    }
  }
  return signed;
}

/** Sign all url/thumbnail_url fields in an array of objects */
export function signUrlsInList<T extends Record<string, unknown>>(items: T[], fields: string[] = ['url', 'thumbnail_url']): T[] {
  return items.map((item) => signFields(item, fields));
}
