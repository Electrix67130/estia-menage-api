import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

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

/** Laisse les envois détachés de la réponse HTTP se terminer. */
export async function laisserPartirLesPush(ms = 120): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
