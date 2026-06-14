import { Knex } from 'knex';

/**
 * Envoi de notifications push via l'API Push d'Expo (https://exp.host).
 * Pas de SDK externe : un simple POST suffit. Les tokens invalides
 * (DeviceNotRegistered) sont supprimes automatiquement.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

/**
 * Catégories de préférences de notifications (toggles côté app). Une catégorie
 * désactivée (`notification_prefs[cat] === false`) coupe les push associés.
 */
export const NOTIFICATION_CATEGORIES = [
  'assignment', // ménages assignés / modifiés / annulés / retirés
  'available', // nouveaux ménages disponibles + relances
  'reminders', // rappels veille / 2h avant
  'reschedule', // demandes & réponses de report
  'presence', // réponses présent/absent
  'pointage', // arrivées / départs
  'validation', // ménages validés
  'comments', // nouveaux commentaires
  'consumables', // consommables à racheter
  'invitations', // invitations acceptées
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Mappe le `data.type` d'une push vers sa catégorie de préférence. */
const CATEGORY_FOR_TYPE: Record<string, NotificationCategory> = {
  assignment: 'assignment',
  updated: 'assignment',
  cancelled: 'assignment',
  unassigned: 'assignment',
  available: 'available',
  relance: 'available',
  reminder_eve: 'reminders',
  reminder_2h: 'reminders',
  reschedule_request: 'reschedule',
  reschedule_decision: 'reschedule',
  reschedule_cancelled: 'reschedule',
  response: 'presence',
  arrival: 'pointage',
  departure: 'pointage',
  validated: 'validation',
  comment: 'comments',
  consumables_low: 'consumables',
  invitation_accepted: 'invitations',
};

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

  // Filtre selon les préférences de notifications du user pour cette catégorie.
  const category = CATEGORY_FOR_TYPE[String(message.data?.type ?? '')];
  let recipientIds = uniqueUserIds;
  if (category) {
    const prefRows = (await db('user')
      .whereIn('id', uniqueUserIds)
      .select('id', 'notification_prefs')) as {
      id: string;
      notification_prefs: Record<string, boolean> | null;
    }[];
    const disabled = new Set(
      prefRows.filter((r) => r.notification_prefs?.[category] === false).map((r) => r.id),
    );
    recipientIds = uniqueUserIds.filter((id) => !disabled.has(id));
  }
  if (recipientIds.length === 0) return;

  const rows = (await db('device_token')
    .whereIn('user_id', recipientIds)
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

/** Nom affichable d'un user (prénom nom), fallback générique. */
async function userName(db: Knex, userId: string): Promise<string> {
  const u = (await db('user')
    .where({ id: userId })
    .select('first_name', 'last_name')
    .first()) as { first_name?: string; last_name?: string } | undefined;
  const name = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
  return name || 'Un prestataire';
}

/** Admins de l'org d'un ménage (hors un user optionnel). */
async function orgAdminsForMenage(
  db: Knex,
  menageId: string,
  exceptUserId?: string,
): Promise<string[]> {
  const menage = (await db('menage')
    .where({ id: menageId })
    .select('organization_id')
    .first()) as { organization_id: string } | undefined;
  if (!menage) return [];
  const admins = (await db('organization_member')
    .where({ organization_id: menage.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  return admins.map((a) => a.user_id).filter((id) => id !== exceptUserId);
}

/** Réponse présent/absent d'un prestataire → admins. */
export async function notifyMenageResponse(
  db: Knex,
  menageId: string,
  responderId: string,
  status: 'present' | 'absent',
): Promise<void> {
  const [label, recipients, name] = await Promise.all([
    menageLabel(db, menageId),
    orgAdminsForMenage(db, menageId, responderId),
    userName(db, responderId),
  ]);
  if (!label || recipients.length === 0) return;
  const dispo = status === 'present' ? 'disponible' : 'indisponible';
  await sendPushToUsers(db, recipients, {
    title: 'Réponse prestataire',
    body: `${name} est ${dispo} — ménage du ${label.dateLabel}${label.lieu}`,
    data: { menage_id: menageId, type: 'response' },
  });
}

/** Pointage d'arrivée du prestataire → admins. */
export async function notifyMenageArrival(
  db: Knex,
  menageId: string,
  prestaId: string,
): Promise<void> {
  const [label, recipients, name] = await Promise.all([
    menageLabel(db, menageId),
    orgAdminsForMenage(db, menageId, prestaId),
    userName(db, prestaId),
  ]);
  if (!label || recipients.length === 0) return;
  await sendPushToUsers(db, recipients, {
    title: 'Prestataire arrivé',
    body: `${name} est arrivé sur le ménage du ${label.dateLabel}${label.lieu}`,
    data: { menage_id: menageId, type: 'arrival' },
  });
}

/** Pointage de départ (ménage terminé) → admins. */
export async function notifyMenageDeparture(
  db: Knex,
  menageId: string,
  prestaId: string,
): Promise<void> {
  const [label, recipients, name] = await Promise.all([
    menageLabel(db, menageId),
    orgAdminsForMenage(db, menageId, prestaId),
    userName(db, prestaId),
  ]);
  if (!label || recipients.length === 0) return;
  await sendPushToUsers(db, recipients, {
    title: 'Ménage terminé',
    body: `${name} a terminé le ménage du ${label.dateLabel}${label.lieu}`,
    data: { menage_id: menageId, type: 'departure' },
  });
}

/** Rapport validé → prestataires assignés. */
export async function notifyMenageValidated(
  db: Knex,
  menageId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const label = await menageLabel(db, menageId);
  if (!label) return;
  await sendPushToUsers(db, userIds, {
    title: 'Ménage validé',
    body: `Ton ménage du ${label.dateLabel}${label.lieu} a été validé.`,
    data: { menage_id: menageId, type: 'validated' },
  });
}

/** Demande de report annulée par le prestataire → admins. */
export async function notifyRescheduleCancelled(
  db: Knex,
  menageId: string,
  requesterId: string,
): Promise<void> {
  const [label, recipients, name] = await Promise.all([
    menageLabel(db, menageId),
    orgAdminsForMenage(db, menageId, requesterId),
    userName(db, requesterId),
  ]);
  if (!label || recipients.length === 0) return;
  await sendPushToUsers(db, recipients, {
    title: 'Demande de report annulée',
    body: `${name} a annulé sa demande de report — ménage du ${label.dateLabel}${label.lieu}`,
    data: { menage_id: menageId, type: 'reschedule_cancelled' },
  });
}

/** Consommables passés sous le seuil au relevé de fin → admins. */
export async function notifyConsumablesLow(
  db: Knex,
  menageId: string,
  labels: string[],
  exceptUserId?: string,
): Promise<void> {
  if (labels.length === 0) return;
  const [label, recipients] = await Promise.all([
    menageLabel(db, menageId),
    orgAdminsForMenage(db, menageId, exceptUserId),
  ]);
  if (!label || recipients.length === 0) return;
  const lieu = label.lieu ? label.lieu.replace(/^ — /, '') : 'Logement';
  await sendPushToUsers(db, recipients, {
    title: 'Consommables à racheter',
    body: `${lieu} · ${labels.join(', ')}`,
    data: { menage_id: menageId, type: 'consumables_low' },
  });
}

/** Invitation acceptée → l'inviteur. */
export async function notifyInvitationAccepted(
  db: Knex,
  inviterId: string,
  newUserName: string,
  orgName: string,
): Promise<void> {
  await sendPushToUsers(db, [inviterId], {
    title: 'Invitation acceptée',
    body: `${newUserName} a rejoint ${orgName}.`,
    data: { type: 'invitation_accepted' },
  });
}

/** Rappel programmé (veille 18h ou 2h avant) → prestataires assignés. */
export async function notifyMenageReminder(
  db: Knex,
  menageId: string,
  userIds: string[],
  when: 'eve' | '2h',
): Promise<void> {
  if (userIds.length === 0) return;
  const label = await menageLabel(db, menageId);
  if (!label) return;
  const body =
    when === 'eve'
      ? `Demain · ${label.dateLabel}${label.lieu}`
      : `Bientôt (dans ~2h) · ${label.dateLabel}${label.lieu}`;
  await sendPushToUsers(db, userIds, {
    title: 'Rappel ménage',
    body,
    data: { menage_id: menageId, type: when === 'eve' ? 'reminder_eve' : 'reminder_2h' },
  });
}

/**
 * Relance (la veille) les prestataires membres du logement qui ne se sont PAS
 * encore positionnés (aucune réponse présent/absent) sur un ménage non assigné.
 */
export async function notifyMenageRelance(db: Knex, menageId: string): Promise<void> {
  const label = await menageLabel(db, menageId);
  if (!label) return;
  const members = (await db('logement_member')
    .where({ logement_id: label.logementId, role: 'prestataire' })
    .select('user_id')) as { user_id: string }[];
  const responded = (await db('menage_response')
    .where({ menage_id: menageId })
    .select('user_id')) as { user_id: string }[];
  const respondedSet = new Set(responded.map((r) => r.user_id));
  const recipients = members.map((m) => m.user_id).filter((id) => !respondedSet.has(id));
  if (recipients.length === 0) return;
  await sendPushToUsers(db, recipients, {
    title: 'Ménage à pourvoir demain',
    body: `${label.dateLabel}${label.lieu} · indique ta disponibilité`,
    data: { menage_id: menageId, type: 'relance' },
  });
}
