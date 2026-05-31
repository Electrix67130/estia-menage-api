import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import env from '@/config/env';
import { getCachedSessionId, setCachedSessionId } from '@/lib/session-cache';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; jti?: string; platform?: 'mobile' | 'web' };
    user: { sub: string; email: string; jti?: string; platform?: 'mobile' | 'web' };
  }
}

async function jwtPlugin(fastify: FastifyInstance) {
  fastify.register(jwt, {
    secret: env.JWT_SECRET,
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or missing token',
      });
    }

    // Sessions par plateforme : mobile + web peuvent coexister. Pour chaque
    // plateforme on garde une session active (current_<platform>_session_id) ;
    // une nouvelle connexion sur la même plateforme invalide la précédente.
    // Les tokens legacy sans claim `platform` (frontends pas encore mis à jour)
    // sont acceptés sans vérification — sera nettoyé au prochain login.
    const tokenJti = request.user?.jti;
    const platform = request.user?.platform;
    if (!tokenJti || !platform) {
      return; // accepte (legacy) — pas de single-session check
    }

    const cacheKey = `${request.user.sub}:${platform}`;
    const cached = getCachedSessionId(cacheKey);
    let dbSessionId: string | null;
    if (cached === undefined) {
      const col = platform === 'mobile' ? 'current_mobile_session_id' : 'current_web_session_id';
      const row = await fastify.db('user').where({ id: request.user.sub }).select(col).first();
      dbSessionId = (row?.[col] as string | null) ?? null;
      setCachedSessionId(cacheKey, dbSessionId);
    } else {
      dbSessionId = cached;
    }

    if (dbSessionId !== tokenJti) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Session expired (logged in elsewhere on this device type)',
      });
    }
  });
}

export default fp(jwtPlugin, { name: 'jwt' });
