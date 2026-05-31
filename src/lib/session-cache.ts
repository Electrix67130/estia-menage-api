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

export function invalidateSessionCache(userId: string): void {
  cache.delete(userId);
}
