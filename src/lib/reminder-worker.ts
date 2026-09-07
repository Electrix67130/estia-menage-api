import { FastifyInstance } from 'fastify';
import {
  notifyMenageReminder,
  notifyMenageRelance,
  notifyMenageBedsMissing,
} from '@/lib/push';

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const INITIAL_DELAY_MS = 20 * 1000; // 20s après le boot
const EVE_HOUR = 18; // heure (locale) d'envoi du rappel "veille"
const BEDS_HOUR = 9; // heure (locale) de l'alerte admin "lits à renseigner" (la veille)
const TWO_HOURS_MIN = 120;
const TZ = 'Europe/Paris';

/** Composantes date/heure courantes en Europe/Paris (DST-safe via Intl). */
function parisNow(): { date: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Renvoie la date du lendemain (YYYY-MM-DD) à partir d'une date calendaire. */
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface MenageRow {
  id: string;
  date_prevue: string | Date;
  horaire_prevu: string | null;
  prestation_type?: string;
  n_lit_simple?: number;
  n_lit_double?: number;
  n_canape_lit?: number;
  n_lit_appoint?: number;
  n_lit_parapluie?: number;
}

/**
 * True quand aucun couchage n'est renseigné sur un ménage : l'admin n'a pas
 * indiqué le nombre de lits à faire (ni le logement ne l'a fourni par défaut).
 * Ne concerne que les prestations de type `menage` (check-in/out = pas de linge).
 */
function bedsMissing(m: MenageRow): boolean {
  if ((m.prestation_type ?? 'menage') !== 'menage') return false;
  const total =
    (m.n_lit_simple ?? 0) +
    (m.n_lit_double ?? 0) +
    (m.n_canape_lit ?? 0) +
    (m.n_lit_appoint ?? 0) +
    (m.n_lit_parapluie ?? 0);
  return total === 0;
}

function ymd(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

async function assignedUserIds(app: FastifyInstance, menageId: string): Promise<string[]> {
  const rows = (await app.db('menage_prestataire')
    .where({ menage_id: menageId })
    .select('user_id')) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

/**
 * Worker de rappels push :
 *  - Veille à 18h (locale) : rappel aux prestataires assignés ; si le ménage
 *    n'est pas assigné, relance les prestataires du logement non positionnés.
 *  - Veille à 9h (locale) : alerte les admins quand le nombre de lits à faire
 *    n'a pas été renseigné sur le ménage du lendemain.
 *  - 2h avant l'heure prévue : rappel aux prestataires assignés.
 *
 * Anti-doublon via `menage.reminder_eve_sent_at` / `reminder_beds_sent_at` /
 * `reminder_2h_sent_at`.
 * Même philosophie que `ical-worker` : setInterval simple, jamais de crash.
 */
export function startReminderWorker(app: FastifyInstance): () => void {
  let running = false;

  const tick = async () => {
    if (running) {
      app.log.warn('reminder-worker: previous tick still running, skip');
      return;
    }
    running = true;
    try {
      const now = parisNow();
      const nowMinutes = now.hour * 60 + now.minute;

      // --- Passe "veille 18h" ---------------------------------------------
      if (now.hour >= EVE_HOUR) {
        const tomorrow = nextDay(now.date);
        const eveMenages = (await app.db('menage')
          .where({ date_prevue: tomorrow, status: 'a_venir' })
          .whereNull('reminder_eve_sent_at')
          .whereNull('archived_at')
          .select('id', 'date_prevue', 'horaire_prevu')) as MenageRow[];

        for (const m of eveMenages) {
          try {
            const assigned = await assignedUserIds(app, m.id);
            if (assigned.length > 0) {
              await notifyMenageReminder(app.db, m.id, assigned, 'eve');
            } else {
              await notifyMenageRelance(app.db, m.id);
            }
          } catch (err) {
            app.log.error({ err, menage_id: m.id }, 'reminder-worker: eve notify failed');
          }
          // On marque dans tous les cas pour ne pas re-tenter en boucle.
          await app.db('menage').where({ id: m.id }).update({ reminder_eve_sent_at: new Date() });
        }
        if (eveMenages.length) {
          app.log.info(`reminder-worker: ${eveMenages.length} rappel(s) veille traité(s)`);
        }
      }

      // --- Passe "lits à renseigner" (veille 9h) ---------------------------
      if (now.hour >= BEDS_HOUR) {
        const tomorrow = nextDay(now.date);
        const bedsMenages = (await app.db('menage')
          .where({ date_prevue: tomorrow, status: 'a_venir', prestation_type: 'menage' })
          .whereNull('reminder_beds_sent_at')
          .whereNull('archived_at')
          .select(
            'id',
            'date_prevue',
            'horaire_prevu',
            'prestation_type',
            'n_lit_simple',
            'n_lit_double',
            'n_canape_lit',
            'n_lit_appoint',
            'n_lit_parapluie',
          )) as MenageRow[];

        for (const m of bedsMenages) {
          if (bedsMissing(m)) {
            try {
              await notifyMenageBedsMissing(app.db, m.id);
            } catch (err) {
              app.log.error({ err, menage_id: m.id }, 'reminder-worker: beds notify failed');
            }
          }
          // Marqué dans tous les cas : l'alerte ne se déclenche qu'une fois.
          await app.db('menage').where({ id: m.id }).update({ reminder_beds_sent_at: new Date() });
        }
      }

      // --- Passe "2h avant" -----------------------------------------------
      const todayMenages = (await app.db('menage')
        .where({ date_prevue: now.date, status: 'a_venir' })
        .whereNotNull('horaire_prevu')
        .whereNull('reminder_2h_sent_at')
        .whereNull('archived_at')
        .select('id', 'date_prevue', 'horaire_prevu')) as MenageRow[];

      for (const m of todayMenages) {
        if (ymd(m.date_prevue) !== now.date || !m.horaire_prevu) continue;
        const [h, min] = m.horaire_prevu.split(':').map(Number);
        const startMinutes = h * 60 + (min || 0);
        const minutesUntil = startMinutes - nowMinutes;
        // Fenêtre : le ménage commence dans les 2 prochaines heures (et pas encore passé).
        if (minutesUntil > TWO_HOURS_MIN || minutesUntil < 0) continue;
        try {
          const assigned = await assignedUserIds(app, m.id);
          if (assigned.length > 0) {
            await notifyMenageReminder(app.db, m.id, assigned, '2h');
          }
        } catch (err) {
          app.log.error({ err, menage_id: m.id }, 'reminder-worker: 2h notify failed');
        }
        await app.db('menage').where({ id: m.id }).update({ reminder_2h_sent_at: new Date() });
      }
    } catch (err) {
      app.log.error({ err }, 'reminder-worker: tick error');
    } finally {
      running = false;
    }
  };

  const initialTimer = setTimeout(() => {
    void tick();
  }, INITIAL_DELAY_MS);
  const interval = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
