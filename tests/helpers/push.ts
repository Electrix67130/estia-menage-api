import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { applicationEnCours } from './app';

/**
 * Capture les notifications envoyées, sans réseau.
 *
 * `sendPushToUsers` termine par un POST à l'API d'Expo : on intercepte `fetch`
 * et on relit ce qui lui est passé. Tester au niveau du HTTP sortant, plutôt
 * qu'en espionnant nos propres fonctions, vérifie la chaîne complète —
 * destinataires, préférences, jetons — et pas seulement qu'on a appelé un
 * helper.
 */
export interface PushCapturee {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export function capturerPush(): { messages: PushCapturee[]; restore: () => void } {
  const messages: PushCapturee[] = [];
  const original = globalThis.fetch;

  type ParamsFetch = Parameters<typeof fetch>;
  globalThis.fetch = vi.fn(async (url: ParamsFetch[0], init?: ParamsFetch[1]) => {
    if (String(url).includes('exp.host')) {
      dernierEnvoi = Date.now();
      const envoye = JSON.parse(String(init?.body ?? '[]')) as PushCapturee[];
      messages.push(...envoye);
      return new Response(JSON.stringify({ data: envoye.map(() => ({ status: 'ok' })) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(url, init);
  }) as typeof fetch;

  return { messages, restore: () => { globalThis.fetch = original; } };
}

/**
 * Un appareil enregistré pour ce compte : sans jeton, `sendPushToUsers` s'arrête
 * avant d'appeler Expo et aucun test de notification ne prouverait quoi que ce soit.
 */
export async function enregistrerAppareil(
  app: FastifyInstance,
  userId: string,
  token = `ExponentPushToken[${userId.slice(0, 8)}]`,
): Promise<string> {
  await app.db('device_token').insert({ user_id: userId, token, platform: 'ios' });
  return token;
}

let dernierEnvoi = 0;

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La base n'a-t-elle plus aucune requête en cours ni en attente ? */
function baseAuRepos(): boolean {
  const pool = (
    applicationEnCours()?.db.client as { pool?: { numUsed(): number; numPendingAcquires(): number } } | undefined
  )?.pool;
  return !pool || (pool.numUsed() === 0 && pool.numPendingAcquires() === 0);
}

/**
 * Laisse les envois détachés de la réponse HTTP se terminer. Un délai fixe
 * était fragile : sur la CI, plus lente, une push partie après lui faisait
 * échouer le test. On attend donc que tout soit au repos — plus aucune requête
 * en base pendant trois relevés consécutifs, et rien envoyé à Expo depuis —
 * avec un plafond de sécurité.
 */
export async function laisserPartirLesPush(minimum = 40, plafond = 3000): Promise<void> {
  const debut = Date.now();
  await attendre(minimum);
  let calme = 0;
  while (calme < 3 && Date.now() - debut < plafond) {
    await attendre(20);
    calme = baseAuRepos() && Date.now() - dernierEnvoi > 20 ? calme + 1 : 0;
  }
}
