import { Knex } from 'knex';
import { WebSocket } from 'ws';

/**
 * Hub temps reel : tient en memoire la liste des WebSocket actifs par user.
 * Permet de pousser des events vers un user specifique ou vers tous les
 * users qui ont acces a un menage.
 */

export type RealtimeEventType =
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'photo.created'
  | 'photo.deleted'
  | 'menage.arrival'
  | 'menage.departure'
  | 'menage.validated'
  | 'menage-check-item.toggled';

export interface RealtimeEvent {
  type: RealtimeEventType;
  menage_id: string;
  resource_id?: string;
  actor_id?: string;
}

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, ws: WebSocket): void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(ws);
}

export function removeConnection(userId: string, ws: WebSocket): void {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

export function emitToUser(userId: string, event: RealtimeEvent): void {
  const set = connections.get(userId);
  if (!set) return;
  const payload = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Emet l'event a tous les users qui ont acces au menage :
 * - admin de l'org du menage
 * - createur du menage
 * - membres du logement parent (logement_member)
 *
 * On exclut l'auteur de l'action lui-meme (event.actor_id) — il a deja l'info
 * via la mutation locale, pas la peine de le re-notifier.
 */
export async function emitToMenage(
  db: Knex,
  menageId: string,
  event: RealtimeEvent,
): Promise<void> {
  const menage = await db('menage')
    .where({ id: menageId })
    .select('organization_id', 'created_by', 'logement_id')
    .first();
  if (!menage) return;

  const userIds = new Set<string>();

  // Createur du menage.
  userIds.add(menage.created_by);

  // Admins de l'org du menage (via organization_member).
  const admins = (await db('organization_member')
    .where({ organization_id: menage.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  for (const a of admins) userIds.add(a.user_id);

  // Membres du logement parent (prestataires, responsables, client…).
  const members = (await db('logement_member')
    .where({ logement_id: menage.logement_id })
    .select('user_id')) as { user_id: string }[];
  for (const m of members) userIds.add(m.user_id);

  // On retire l'acteur — pas besoin de se notifier soi-meme.
  if (event.actor_id) userIds.delete(event.actor_id);

  for (const userId of userIds) {
    emitToUser(userId, event);
  }
}

/**
 * Force la fermeture de toutes les connexions d'un user.
 * Codes utilises :
 * - 'logout' (code 1000) : logout volontaire
 * - 'session-replaced' (code 4001) : nouvelle connexion ailleurs (single-session)
 *   Le frontend reconnait ce code custom pour declencher un logout immediat.
 */
export function closeUserConnections(
  userId: string,
  reason: 'logout' | 'session-replaced' = 'logout',
): void {
  const set = connections.get(userId);
  if (!set) return;
  const code = reason === 'session-replaced' ? 4001 : 1000;
  for (const ws of set) {
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
  }
  connections.delete(userId);
}

export function activeUserCount(): number {
  return connections.size;
}
