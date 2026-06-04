// Cache TTL en memoire pour le current_session_id de chaque user.
// Evite une lecture BDD a chaque requete authentifiee.

const TTL_MS = 30_000; // 30 secondes

interface Entry {
  sessionId: string | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function getCachedSessionId(userId: string): string | null | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(userId);
    return undefined;
  }
  return entry.sessionId;
}

export function setCachedSessionId(userId: string, sessionId: string | null): void {
  cache.set(userId, { sessionId, expiresAt: Date.now() + TTL_MS });
}

// Les clés de cache sont de la forme `${userId}:${platform}` (voir jwt.ts).
// On purge donc TOUTES les entrées du user (web + mobile), quel que soit le
// suffixe plateforme — sinon l'invalidation au login/logout est un no-op et un
// token fraîchement émis est rejeté à tort ("Session expired") jusqu'au TTL.
export function invalidateSessionCache(userId: string): void {
  cache.delete(userId);
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}
