import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, createHmac } from 'crypto';
import { Readable } from 'stream';
import path from 'path';
import { z } from 'zod';
import env from '@/config/env';
import storage from '@/lib/storage';
import { optimizeImageStream, generateThumbnail, isThumbnailable } from '@/lib/image';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache long : les fichiers sont content-addressés (nom = UUID) donc immuables.
// L'accès reste protégé par le token dans l'URL ; une fois téléchargé, le client
// réutilise sa copie tant que l'URL (stable par fenêtre, cf. sign-url) ne change pas.
const FILE_CACHE_MAX_AGE = 24 * 60 * 60; // secondes

/** Generate a signed token: filename + expiry, signed with JWT_SECRET */
function generateFileToken(filename: string): { token: string; expires: number } {
  const expires = Date.now() + TOKEN_TTL_MS;
  const data = `${filename}:${expires}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({ f: filename, e: expires, s: signature })).toString('base64url');
  return { token, expires };
}

/** Verify a file token */
function verifyFileToken(token: string, filename: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (decoded.f !== filename) return false;
    if (decoded.e < Date.now()) return false;
    const expected = createHmac('sha256', env.JWT_SECRET).update(`${decoded.f}:${decoded.e}`).digest('hex');
    return decoded.s === expected;
  } catch {
    return false;
  }
}

async function uploadPlugin(fastify: FastifyInstance) {
  // GET /files/token/:filename — generate a short-lived signed URL (authenticated)
  fastify.get('/files/token/:filename', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params);
    const safeName = path.basename(filename);

    if (!(await storage.exists(safeName))) {
      return reply.notFound('File not found');
    }

    const { token } = generateFileToken(safeName);
    return { url: `${env.APP_URL}/files/${safeName}?t=${token}` };
  });

  // GET /files/:filename?t=xxx — serve file if token is valid (no API key needed)
  fastify.get('/files/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params);
    const { t } = z.object({ t: z.string().min(1) }).parse(request.query);

    const safeName = path.basename(filename);

    if (!verifyFileToken(t, safeName)) {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token expired or invalid' });
    }

    if (!(await storage.exists(safeName))) {
      return reply.notFound('File not found');
    }

    // En mode S3, on redirige vers une URL présignée (le téléchargement se fait
    // directement depuis Object Storage). En local, on sert le fichier du disque.
    if (storage.mode === 's3') {
      const presignTtl = FILE_CACHE_MAX_AGE;
      // Le 302 lui-même est mis en cache un peu moins longtemps que la validité
      // de l'URL présignée, pour ne jamais rejouer un lien S3 expiré.
      reply.header('Cache-Control', `private, max-age=${presignTtl - 60}`);
      return reply.redirect(await storage.presignedUrl(safeName, presignTtl));
    }

    reply.header('Cache-Control', `private, max-age=${FILE_CACHE_MAX_AGE}, immutable`);
    // `cacheControl: false` → on laisse @fastify/static ne PAS écraser notre
    // en-tête (sinon il renverrait son propre Cache-Control par défaut).
    return reply.sendFile(safeName, { cacheControl: false });
  });

  // POST /upload — upload a file (authenticated)
  // Limite généreuse : un envoi groupé de photos (mobile/dashboard) est légitime
  // et ne doit pas tripper le rate-limit global (100/min).
  fastify.post(
    '/upload',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.badRequest('No file provided');
    }

    const ext = path.extname(data.filename) || '';
    const uuid = randomUUID();
    const storedName = `${uuid}${ext}`;

    // Les images sont optimisées à la volée (resize + recompression) avant
    // stockage. Les autres types de fichiers passent tels quels.
    const optimizer = optimizeImageStream(data.mimetype);
    const body = optimizer ? data.file.pipe(optimizer) : data.file;

    const { size } = await storage.upload(storedName, body, data.mimetype);

    // Miniature (~400px) pour les listes/grilles : on relit l'image déjà
    // optimisée (≤2000px, donc légère) et on en dérive un JPEG. Best-effort :
    // un échec ne bloque pas l'upload (thumbnail_url reste undefined → le
    // front retombe sur l'URL originale).
    let thumbnailUrl: string | undefined;
    if (isThumbnailable(data.mimetype)) {
      try {
        const original = await storage.read(storedName);
        const thumb = await generateThumbnail(original);
        const thumbName = `${uuid}_thumb.jpg`;
        await storage.upload(thumbName, Readable.from(thumb.buffer), thumb.contentType);
        thumbnailUrl = `${env.APP_URL}/files/${thumbName}`;
      } catch (err) {
        request.log.error({ err }, 'thumbnail generation failed');
      }
    }

    return reply.code(201).send({
      url: `${env.APP_URL}/files/${storedName}`,
      thumbnail_url: thumbnailUrl,
      original_name: data.filename,
      file_size: size,
      mime_type: data.mimetype,
    });
  });
}

export default fp(uploadPlugin, { name: 'upload' });
