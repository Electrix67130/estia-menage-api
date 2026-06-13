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

/** Récupère un libellé date + logement pour le corps des notifications ménage. */
async function menageLabel(
  db: Knex,
  menageId: string,
): Promise<{ dateLabel: string; lieu: string; logementId: string } | null> {
  const menage = (await db('menage')
    .leftJoin('logement', 'menage.logement_id', 'logement.id')
    .where('menage.id', menageId)
    .select('menage.date_prevue', 'menage.logement_id', 'logement.name as logement_name')
    .first()) as
    | { date_prevue: string; logement_id: string; logement_name: string | null }
    | undefined;
  if (!menage) return null;
  const dateLabel = new Date(menage.date_prevue).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return {
    dateLabel,
    lieu: menage.logement_name ? ` — ${menage.logement_name}` : '',
    logementId: menage.logement_id,
  };
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
  const label = await menageLabel(db, menageId);
  if (!label) return;
  await sendPushToUsers(db, newUserIds, {
    title: 'Nouveau ménage assigné',
    body: `${label.dateLabel}${label.lieu}`,
    data: { menage_id: menageId, type: 'assignment' },
  });
}

/** Ménage modifié (date/horaire) → prestataires assignés. */
export async function notifyMenageUpdated(
  db: Knex,
  menageId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const label = await menageLabel(db, menageId);
  if (!label) return;
  await sendPushToUsers(db, userIds, {
    title: 'Ménage modifié',
    body: `${label.dateLabel}${label.lieu} · la date ou l'horaire a changé`,
    data: { menage_id: menageId, type: 'updated' },
  });
}

/** Ménage annulé → prestataires assignés. */
export async function notifyMenageCancelled(
  db: Knex,
  menageId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const label = await menageLabel(db, menageId);
  if (!label) return;
  await sendPushToUsers(db, userIds, {
    title: 'Ménage annulé',
    body: `Le ménage du ${label.dateLabel}${label.lieu} a été annulé.`,
    data: { menage_id: menageId, type: 'cancelled' },
  });
}

/** Prestataire retiré d'un ménage → le prévenir. */
export async function notifyMenageUnassigned(
  db: Knex,
  menageId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const label = await menageLabel(db, menageId);
  if (!label) return;
  await sendPushToUsers(db, userIds, {
    title: 'Ménage retiré',
    body: `Tu n'es plus assigné au ménage du ${label.dateLabel}${label.lieu}.`,
    data: { menage_id: menageId, type: 'unassigned' },
  });
}

/**
 * Notifie les prestataires membres du logement qu'un nouveau ménage est
 * disponible (créé sans affectation) → ils peuvent se positionner présent/absent.
 */
export async function notifyMenageAvailable(
  db: Knex,
  menageId: string,
  exceptUserId?: string,
): Promise<void> {
  const label = await menageLabel(db, menageId);
  if (!label) return;
  const members = (await db('logement_member')
    .where({ logement_id: label.logementId, role: 'prestataire' })
    .select('user_id')) as { user_id: string }[];
  const recipients = members.map((m) => m.user_id).filter((id) => id !== exceptUserId);
  if (recipients.length === 0) return;
  await sendPushToUsers(db, recipients, {
    title: 'Nouveau ménage disponible',
    body: `${label.dateLabel}${label.lieu} · indique ta disponibilité`,
    data: { menage_id: menageId, type: 'available' },
  });
}
