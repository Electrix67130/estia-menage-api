import type { FastifyInstance, InjectOptions } from 'fastify';
import buildApp from '@/app';

/**
 * Instancie l'application complete — memes plugins, memes routes qu'en
 * production. Les tests passent ensuite par `app.inject()`, qui joue une vraie
 * requete HTTP sans ouvrir de port : rien n'ecoute sur le reseau.
 *
 * La cle d'API est ajoutee d'office a chaque requete, comme le font tous les
 * clients reels : sans elle, chaque appel de chaque test recevrait un 403 sans
 * rapport avec ce qu'il verifie. Un test dedie couvre le rejet d'une cle
 * invalide, et toute en-tete passee explicitement l'emporte.
 */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  await app.ready();

  const inject = app.inject.bind(app);
  app.inject = ((opts: InjectOptions) =>
    inject({
      ...opts,
      headers: { 'x-api-key': process.env.API_KEY, ...(opts.headers ?? {}) },
    })) as typeof app.inject;

  return app;
}

/** En-tete d'authentification pour un jeton d'acces. */
export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
