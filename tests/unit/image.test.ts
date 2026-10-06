import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Readable } from 'stream';
import { generateThumbnail, isThumbnailable, optimizeImageStream } from '@/lib/image';

async function lire(flux: NodeJS.ReadableStream): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  for await (const chunk of flux) morceaux.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(morceaux);
}

async function image(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: '#cc3366' } });
  return format === 'png' ? base.png().toBuffer() : base.jpeg().toBuffer();
}

describe('isThumbnailable', () => {
  it('ne promet une miniature que pour les formats image courants', () => {
    expect(isThumbnailable('image/jpeg')).toBe(true);
    expect(isThumbnailable('image/png')).toBe(true);
    expect(isThumbnailable('image/webp')).toBe(true);
    expect(isThumbnailable('image/svg+xml')).toBe(false);
    expect(isThumbnailable('application/pdf')).toBe(false);
  });
});

describe('generateThumbnail', () => {
  it('tient dans 400 px, en JPEG, sans agrandir une petite image', async () => {
    const grande = await generateThumbnail(await image(1600, 800));
    const metaGrande = await sharp(grande.buffer).metadata();
    expect(grande.contentType).toBe('image/jpeg');
    expect(metaGrande.format).toBe('jpeg');
    expect(metaGrande.width).toBe(400);
    expect(metaGrande.height).toBe(200);

    const petite = await generateThumbnail(await image(120, 90));
    const metaPetite = await sharp(petite.buffer).metadata();
    expect(metaPetite.width).toBe(120);
    expect(metaPetite.height).toBe(90);
  });
});

describe('optimizeImageStream', () => {
  it('ne touche pas aux fichiers qui ne sont pas des images', () => {
    expect(optimizeImageStream('application/pdf')).toBeNull();
    expect(optimizeImageStream('text/plain')).toBeNull();
  });

  it('ramène une image trop grande à 2000 px de côté, dans son format', async () => {
    const flux = optimizeImageStream('image/jpeg');
    expect(flux).not.toBeNull();
    const sortie = await lire(Readable.from(await image(4000, 1000, 'jpeg')).pipe(flux!));
    const meta = await sharp(sortie).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(500);
  });

  it('laisse une image déjà petite à sa taille', async () => {
    const flux = optimizeImageStream('image/png');
    const sortie = await lire(Readable.from(await image(300, 200)).pipe(flux!));
    const meta = await sharp(sortie).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(300);
  });
});
