import { Knex } from 'knex';

/**
 * Ce que chacun choisit de recevoir (inspiré de Buildr). Trois niveaux, du plus
 * large au plus fin :
 * 1. `user.push_enabled` coupe tout ;
 * 2. `user.notification_prefs` coupe une catégorie sur tous les logements ;
 * 3. `logement_notification_level` règle un logement : tout, l'important, ou rien.
 *
 * Tout est actif par défaut : une catégorie absente des préférences, un logement
 * sans réglage, reçoivent tout.
 */

export const NOTIFICATION_CATEGORIES = [
  'assignment', // prestations assignées / modifiées / annulées / retirées
  'available', // nouvelles prestations disponibles + relances
  'reminders', // rappels veille / 2h avant, lits à renseigner
  'reschedule', // demandes & réponses de report
  'presence', // réponses présent/absent
  'pointage', // arrivées / départs
  'validation', // prestations validées
  'comments', // nouveaux commentaires
  'mentions', // quelqu'un m'a mentionné
  'consumables', // consommables à racheter
  'invitations', // invitations acceptées
  'reports', // contenus signalés (admins)
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const LOGEMENT_NOTIFICATION_LEVELS = ['all', 'important', 'none'] as const;
export type LogementNotificationLevel = (typeof LOGEMENT_NOTIFICATION_LEVELS)[number];

/**
 * Ce qui passe encore sur un logement réglé sur « l'important » : ce qui me
 * concerne personnellement — une mention, mon affectation, mes rappels.
 */
const IMPORTANT: readonly NotificationCategory[] = ['mentions', 'assignment', 'reminders'];

/**
 * La catégorie de chaque push, d'après son `data.type`. Un type absent n'est
 * filtré que par l'interrupteur général : la réponse du support à un
 * signalement répond à une demande de la personne elle-même.
 */
const CATEGORY_FOR_TYPE: Record<string, NotificationCategory> = {
  assignment: 'assignment',
  updated: 'assignment',
  cancelled: 'assignment',
  unassigned: 'assignment',
  available: 'available',
  relance: 'available',
  reminder_eve: 'reminders',
  reminder_2h: 'reminders',
  beds_missing: 'reminders',
  reschedule_request: 'reschedule',
  reschedule_decision: 'reschedule',
  reschedule_cancelled: 'reschedule',
  response: 'presence',
  arrival: 'pointage',
  departure: 'pointage',
  validated: 'validation',
  comment: 'comments',
  // Catégorie à part : couper les commentaires ne coupe pas les mentions.
  comment_mention: 'mentions',
  consumables_low: 'consumables',
  invitation_accepted: 'invitations',
  content_report: 'reports',
};

export function categoryForType(type: unknown): NotificationCategory | null {
  return typeof type === 'string' ? (CATEGORY_FOR_TYPE[type] ?? null) : null;
}

/** Les préférences stockées, complétées : toute catégorie absente est active. */
export function resolveCategories(stored: unknown): Record<NotificationCategory, boolean> {
  const prefs = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, prefs[c] !== false])) as Record<
    NotificationCategory,
    boolean
  >;
}

/** Une push passe-t-elle le réglage d'un logement ? */
export function levelAllows(level: string | undefined, category: NotificationCategory | null): boolean {
  if (level === 'none') return false;
  if (level === 'important') return category !== null && IMPORTANT.includes(category);
  return true;
}

/** Le logement d'une push : donné directement, ou celui de la prestation. */
async function logementOf(db: Knex, data: Record<string, unknown> | undefined): Promise<string | null> {
  if (typeof data?.logement_id === 'string') return data.logement_id;
  if (typeof data?.menage_id === 'string') {
    const row = await db('menage').where({ id: data.menage_id }).select('logement_id').first();
    return (row?.logement_id as string | undefined) ?? null;
  }
  return null;
}

/** Parmi `userIds`, ceux qui veulent recevoir cette push. */
export async function usersAcceptingNotification(
  db: Knex,
  userIds: string[],
  data: Record<string, unknown> | undefined,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = (await db('user')
    .whereIn('id', userIds)
    .where({ push_enabled: true })
    .select('id', 'notification_prefs')) as { id: string; notification_prefs: unknown }[];

  const category = categoryForType(data?.type);
  const logementId = await logementOf(db, data);
  const levels = new Map<string, string>();
  if (logementId && users.length > 0) {
    const rows = (await db('logement_notification_level')
      .where({ logement_id: logementId })
      .whereIn('user_id', users.map((u) => u.id))
      .select('user_id', 'level')) as { user_id: string; level: string }[];
    for (const row of rows) levels.set(row.user_id, row.level);
  }

  return users
    .filter((u) => category === null || resolveCategories(u.notification_prefs)[category])
    .filter((u) => levelAllows(levels.get(u.id), category))
    .map((u) => u.id);
}
