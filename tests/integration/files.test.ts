import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin } from '../helpers/factories';
import { UPLOAD_DIR } from '@/lib/storage';
import { signFileUrl } from '@/lib/sign-url';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(() => truncateAll(app.db));

// Fichiers écrits dans `uploads/` pendant les tests : on nettoie derrière soi,
// le dossier est partagé avec le serveur de développement.
const aNettoyer: string[] = [];
afterAll(() => {
  for (const nom of aNettoyer) fs.rmSync(path.join(UPLOAD_DIR, nom), { force: true });
});

function deposer(nom: string, contenu: Buffer | string): void {
  fs.writeFileSync(path.join(UPLOAD_DIR, nom), contenu);
  aNettoyer.push(nom);
}

describe('clé d’API', () => {
  it('garde toutes les routes, sauf la santé et les pages publiques', async () => {
    const sansCle = await app.inject({ method: 'GET', url: '/organization', headers: { 'x-api-key': '' } });
    expect(sansCle.statusCode).toBe(403);
    const mauvaise = await app.inject({ method: 'GET', url: '/organization', headers: { 'x-api-key': 'autre' } });
    expect(mauvaise.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/health', headers: { 'x-api-key': '' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/privacy', headers: { 'x-api-key': '' } })).statusCode).toBe(200);
  });

  it('exige ensuite un jeton valide', async () => {
    const res = await app.inject({ method: 'GET', url: '/organization' });
    expect(res.statusCode).toBe(401);
    const bidon = await app.inject({ method: 'GET', url: '/organization', headers: auth('pas-un-jwt') });
    expect(bidon.statusCode).toBe(401);
  });
});

describe('fichiers signés', () => {
  it('sert un fichier avec une signature valide et un cache long ; refuse sans ou avec un mauvais jeton', async () => {
    deposer('test-signe.txt', 'contenu');
    const url = signFileUrl(`${process.env.APP_URL}/files/test-signe.txt`);
    const chemin = url.replace(process.env.APP_URL as string, '');

    const ok = await app.inject({ method: 'GET', url: chemin, headers: { 'x-api-key': '' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('contenu');
    expect(ok.headers['cache-control']).toContain('immutable');

    expect((await app.inject({ method: 'GET', url: '/files/test-signe.txt' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/files/test-signe.txt?t=bidon' })).statusCode).toBe(403);
  });

  it('une signature ne vaut que pour son fichier', async () => {
    deposer('test-a.txt', 'A');
    deposer('test-b.txt', 'B');
    const token = new URL(signFileUrl(`${process.env.APP_URL}/files/test-a.txt`)).searchParams.get('t');
    const res = await app.inject({ method: 'GET', url: `/files/test-b.txt?t=${token}` });
    expect(res.statusCode).toBe(403);
  });

  it('un fichier inconnu, même bien signé, n’existe pas', async () => {
    const chemin = signFileUrl(`${process.env.APP_URL}/files/inexistant.txt`).replace(process.env.APP_URL as string, '');
    expect((await app.inject({ method: 'GET', url: chemin })).statusCode).toBe(404);
  });

  it('la route de signature est authentifiée et ne signe que ce qui existe', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    deposer('test-token.txt', 'x');
    expect((await app.inject({ method: 'GET', url: '/files/token/test-token.txt' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/files/token/inconnu.txt', headers: auth(admin.token) })).statusCode,
    ).toBe(404);
    const ok = await app.inject({ method: 'GET', url: '/files/token/test-token.txt', headers: auth(admin.token) });
    expect(ok.statusCode).toBe(200);
    const signee = (ok.json().url as string).replace(process.env.APP_URL as string, '');
    expect((await app.inject({ method: 'GET', url: signee })).statusCode).toBe(200);
  });
});

describe('téléversement', () => {
  function multipart(nom: string, type: string, contenu: Buffer): { payload: Buffer; headers: Record<string, string> } {
    const frontiere = 'frontiere-de-test';
    const entete = Buffer.from(
      `--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="${nom}"\r\nContent-Type: ${type}\r\n\r\n`,
    );
    const fin = Buffer.from(`\r\n--${frontiere}--\r\n`);
    return {
      payload: Buffer.concat([entete, contenu, fin]),
      headers: { 'content-type': `multipart/form-data; boundary=${frontiere}` },
    };
  }

  it('optimise une image et en dérive une miniature', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3366cc' } })
      .png()
      .toBuffer();
    const { payload, headers } = multipart('photo.png', 'image/png', image);

    const res = await app.inject({ method: 'POST', url: '/upload', headers: { ...auth(admin.token), ...headers }, payload });
    expect(res.statusCode).toBe(201);
    const corps = res.json() as { url: string; thumbnail_url?: string; original_name: string; mime_type: string; file_size: number };
    expect(corps.original_name).toBe('photo.png');
    expect(corps.mime_type).toBe('image/png');
    expect(corps.file_size).toBeGreaterThan(0);

    const nom = corps.url.split('/').pop() as string;
    const nomMiniature = (corps.thumbnail_url as string).split('/').pop() as string;
    aNettoyer.push(nom, nomMiniature);
    expect(fs.existsSync(path.join(UPLOAD_DIR, nom))).toBe(true);

    // La vignette tient dans 400 px et est servie en JPEG.
    const meta = await sharp(path.join(UPLOAD_DIR, nomMiniature)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(400);
    expect(nomMiniature.endsWith('_thumb.jpg')).toBe(true);
  });

  it('laisse passer un fichier qui n’est pas une image, sans miniature', async () => {
    const { admin } = await createOrgWithAdmin(app, 'Conciergerie');
    const { payload, headers } = multipart('notes.txt', 'text/plain', Buffer.from('bonjour'));
    const res = await app.inject({ method: 'POST', url: '/upload', headers: { ...auth(admin.token), ...headers }, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().thumbnail_url).toBeUndefined();
    const nom = (res.json().url as string).split('/').pop() as string;
    aNettoyer.push(nom);
    expect(fs.readFileSync(path.join(UPLOAD_DIR, nom), 'utf8')).toBe('bonjour');
  });

  it('exige une authentification', async () => {
    const { payload, headers } = multipart('notes.txt', 'text/plain', Buffer.from('x'));
    expect((await app.inject({ method: 'POST', url: '/upload', headers, payload })).statusCode).toBe(401);
  });
});

describe('pages publiques', () => {
  it('la page d’invitation tente le lien profond vers l’application', async () => {
    const res = await app.inject({ method: 'GET', url: '/invite/jeton-xyz', headers: { 'x-api-key': '' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('estia-clean-connect://invite/jeton-xyz');
    // Le script inline doit être autorisé par la CSP de cette page.
    expect(res.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  it('la page de réinitialisation embarque le jeton et poste vers l’API', async () => {
    const res = await app.inject({ method: 'GET', url: '/reset-password/jeton-abc', headers: { 'x-api-key': '' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"jeton-abc"');
    expect(res.body).toContain('/auth/reset-password');
  });

  it('les pages légales répondent sans clé ni jeton', async () => {
    for (const url of ['/privacy', '/support']) {
      const res = await app.inject({ method: 'GET', url, headers: { 'x-api-key': '' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    }
  });
});
