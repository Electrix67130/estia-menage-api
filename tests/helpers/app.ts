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
      // Le limiteur de debit global (100 req/min par IP) compte chaque requete
      // injectee depuis 127.0.0.1 : un fichier un peu long tombait en 429 sans
      // rapport avec ce qu'il verifie. Chaque requete part donc d'une adresse
      // distincte — le limiteur n'est pas ce que ces tests prouvent.
      remoteAddress: opts.remoteAddress ?? nextRemoteAddress(),
      headers: { 'x-api-key': process.env.API_KEY, ...(opts.headers ?? {}) },
    })) as typeof app.inject;

  return app;
}

let requestCounter = 0;
function nextRemoteAddress(): string {
  requestCounter += 1;
  const n = requestCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/** En-tete d'authentification pour un jeton d'acces. */
export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
