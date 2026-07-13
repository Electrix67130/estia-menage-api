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
  | 'menage.declaration'
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
/**
 * Calcule la liste des users ayant acces a un menage (createur + admins de
 * l'org + membres du logement parent), optionnellement en excluant un user
 * (typiquement l'acteur de l'action). Partage entre le temps reel (WebSocket)
 * et les notifications push.
 */
export async function getMenageRecipientIds(
  db: Knex,
  menageId: string,
  exceptUserId?: string,
): Promise<string[]> {
  const menage = await db('menage')
    .where({ id: menageId })
    .select('organization_id', 'created_by', 'logement_id', 'prestataire_user_id')
    .first();
  if (!menage) return [];

  const userIds = new Set<string>();

  // Createur du menage.
  userIds.add(menage.created_by);

  // Admins de l'org du menage (via organization_member).
  const admins = (await db('organization_member')
    .where({ organization_id: menage.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  for (const a of admins) userIds.add(a.user_id);

  // Prestataires AFFECTÉS à cette prestation : référent + co-prestataires. Un
  // presta n'est notifié que pour SES prestations — être simple membre
  // `prestataire` du logement ne suffit pas (sinon une photo/un commentaire posé
  // par un autre presta sur SA prestation notifiait tout le monde).
  if (menage.prestataire_user_id) userIds.add(menage.prestataire_user_id);
  const coPrestataires = (await db('menage_prestataire')
    .where({ menage_id: menageId })
    .select('user_id')) as { user_id: string }[];
  for (const p of coPrestataires) userIds.add(p.user_id);

  // Membres superviseurs / propriétaires du logement : managers (supervision) et
  // client_proprietaire (suivi de son bien) sont notifiés sur tout le logement.
  // Les membres de rôle `prestataire` NON affectés en sont exclus.
  const members = (await db('logement_member')
    .where({ logement_id: menage.logement_id })
    .whereIn('role', ['manager', 'client_proprietaire'])
    .select('user_id')) as { user_id: string }[];
  for (const m of members) userIds.add(m.user_id);

  // On retire l'acteur — pas besoin de se notifier soi-meme.
  if (exceptUserId) userIds.delete(exceptUserId);

  return [...userIds];
}

export async function emitToMenage(
  db: Knex,
  menageId: string,
  event: RealtimeEvent,
): Promise<void> {
  const userIds = await getMenageRecipientIds(db, menageId, event.actor_id);
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
