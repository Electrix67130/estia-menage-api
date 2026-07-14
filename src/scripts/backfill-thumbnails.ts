/**
 * Backfill des miniatures (`thumbnail_url`) pour les images déjà en base
 * (uploadées avant la génération automatique à l'upload).
 *
 * Pour chaque ligne ayant une image mais pas de miniature : on lit le fichier
 * original via le storage, on génère une vignette (~400px) et on la stocke, puis
 * on renseigne la colonne miniature.
 *
 *   npm run backfill:thumbnails
 *
 * Idempotent : ne retraite jamais une ligne qui a déjà une miniature.
 * À lancer une fois, dans le même environnement que l'API (mêmes variables
 * d'env : DB_*, STORAGE_MODE, APP_URL, éventuellement S3_*).
 */
import { Readable } from 'stream';
import knex from 'knex';
import knexConfig from '@/config/knexfile';
import env from '@/config/env';
import storage from '@/lib/storage';
import { generateThumbnail } from '@/lib/image';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** `https://api/files/abc.jpg?t=xxx` → `abc.jpg` (null si pas une image /files). */
function fileNameFromUrl(url: string | null): string | null {
  if (!url || !url.includes('/files/')) return null;
  const name = url.split('/').pop()?.split('?')[0];
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return IMAGE_EXT.has(ext) ? name : null;
}

/** Génère + stocke la miniature d'un fichier ; renvoie son URL publique (ou null). */
async function makeThumbnail(fileName: string): Promise<string | null> {
  if (!(await storage.exists(fileName))) return null;
  const original = await storage.read(fileName);
  const thumb = await generateThumbnail(original);
  const base = fileName.slice(0, fileName.lastIndexOf('.')) || fileName;
  const thumbName = `${base}_thumb.jpg`;
  await storage.upload(thumbName, Readable.from(thumb.buffer), thumb.contentType);
  return `${env.APP_URL}/files/${thumbName}`;
}

interface Target {
  table: string;
  urlCol: string;
  thumbCol: string;
}

const TARGETS: Target[] = [
  { table: 'photo', urlCol: 'url', thumbCol: 'thumbnail_url' },
  { table: 'user', urlCol: 'avatar_url', thumbCol: 'avatar_thumbnail_url' },
  { table: 'logement', urlCol: 'cover_photo_url', thumbCol: 'cover_photo_thumbnail_url' },
];

async function run(): Promise<void> {
  const db = knex(knexConfig);
  let totalDone = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  try {
    for (const t of TARGETS) {
      const rows = (await db(t.table)
        .whereNotNull(t.urlCol)
        .whereNull(t.thumbCol)
        .select('id', t.urlCol)) as Record<string, string>[];
      console.log(`\n[${t.table}] ${rows.length} ligne(s) sans miniature`);

      for (const row of rows) {
        const fileName = fileNameFromUrl(row[t.urlCol]);
        if (!fileName) {
          totalSkipped++;
          continue;
        }
        try {
          const thumbUrl = await makeThumbnail(fileName);
          if (!thumbUrl) {
            totalSkipped++;
            continue;
          }
          await db(t.table).where({ id: row.id }).update({ [t.thumbCol]: thumbUrl });
          totalDone++;
          if (totalDone % 25 === 0) console.log(`  … ${totalDone} miniatures générées`);
        } catch (err) {
          totalFailed++;
          console.error(`  ✗ ${t.table} ${row.id} (${fileName}) :`, (err as Error).message);
        }
      }
    }
    console.log(
      `\nTerminé — ${totalDone} générées, ${totalSkipped} ignorées (non-image/fichier absent), ${totalFailed} en échec.`,
    );
  } finally {
    await db.destroy();
  }
}

run().catch((err) => {
  console.error('Backfill échoué :', err);
  process.exit(1);
});
