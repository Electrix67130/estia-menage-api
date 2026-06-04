import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, createHmac } from 'crypto';
import path from 'path';
import { z } from 'zod';
import env from '@/config/env';
import storage from '@/lib/storage';
import { optimizeImageStream } from '@/lib/image';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      return reply.redirect(await storage.presignedUrl(safeName));
    }

    return reply.sendFile(safeName);
  });

  // POST /upload — upload a file (authenticated)
  fastify.post('/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.badRequest('No file provided');
    }

    const ext = path.extname(data.filename) || '';
    const storedName = `${randomUUID()}${ext}`;

    // Les images sont optimisées à la volée (resize + recompression) avant
    // stockage. Les autres types de fichiers passent tels quels.
    const optimizer = optimizeImageStream(data.mimetype);
    const body = optimizer ? data.file.pipe(optimizer) : data.file;

    const { size } = await storage.upload(storedName, body, data.mimetype);

    return reply.code(201).send({
      url: `${env.APP_URL}/files/${storedName}`,
      original_name: data.filename,
      file_size: size,
      mime_type: data.mimetype,
    });
  });
}

export default fp(uploadPlugin, { name: 'upload' });
