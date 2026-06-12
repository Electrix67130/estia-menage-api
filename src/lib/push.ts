import { Knex } from 'knex';

/**
 * Envoi de notifications push via l'API Push d'Expo (https://exp.host).
 * Pas de SDK externe : un simple POST suffit. Les tokens invalides
 * (DeviceNotRegistered) sont supprimes automatiquement.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

export interface PushMessage {
  title: string;
  body: string;
  /** Donnees embarquees (ex: { menage_id }) pour router au tap. */
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Envoie une notification push a tous les appareils des users donnes.
 * Fire-and-forget cote appelant : les erreurs reseau sont avalees (log) pour
 * ne jamais casser la requete metier.
 */
export async function sendPushToUsers(
  db: Knex,
  userIds: string[],
  message: PushMessage,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueUserIds.length === 0) return;

  const rows = (await db('device_token')
    .whereIn('user_id', uniqueUserIds)
    .select('token')) as { token: string }[];
  const tokens = rows.map((r) => r.token);
  if (tokens.length === 0) return;

  const invalidTokens: string[] = [];

  for (const batch of chunk(tokens, CHUNK_SIZE)) {
    const payload = batch.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: 'default',
      channelId: 'default',
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(batch[i]);
        }
      });
    } catch (err) {
      console.error('[PUSH] Echec envoi batch:', err);
    }
  }

  // Nettoyage des tokens morts (app desinstallee, etc.)
  if (invalidTokens.length > 0) {
    await db('device_token').whereIn('token', invalidTokens).del().catch(() => {});
  }
}

/**
 * Notifie par push les prestataires nouvellement affectes a un menage.
 * Helper metier partage entre l'affectation multi (PUT /menages/:id/prestataires)
 * et l'affectation legacy (PATCH /menages/:id sur prestataire_user_id).
 */
export async function notifyMenageAssignment(
  db: Knex,
  menageId: string,
  newUserIds: string[],
): Promise<void> {
  if (newUserIds.length === 0) return;
  const menage = (await db('menage')
    .leftJoin('logement', 'menage.logement_id', 'logement.id')
    .where('menage.id', menageId)
    .select('menage.date_prevue', 'logement.name as logement_name')
    .first()) as { date_prevue: string; logement_name: string | null } | undefined;
  if (!menage) return;
  const dateLabel = new Date(menage.date_prevue).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const lieu = menage.logement_name ? ` — ${menage.logement_name}` : '';
  await sendPushToUsers(db, newUserIds, {
    title: 'Nouveau ménage assigné',
    body: `${dateLabel}${lieu}`,
    data: { menage_id: menageId, type: 'assignment' },
  });
}
