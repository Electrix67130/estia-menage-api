import { FastifyInstance } from 'fastify';
import LogementExternalCalendarService from '@/modules/logement-external-calendar/logement-external-calendar.service';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const INITIAL_DELAY_MS = 10 * 1000; // 10s après le boot — laisse le serveur respirer

/**
 * Démarre un worker setInterval qui synchronise tous les calendriers iCal
 * externes activés toutes les 30 minutes.
 *
 * Choix volontairement simple (pas de Bull/Redis) pour MVP. Si on a besoin
 * de plus tard :
 *  - exécution distribuée (plusieurs replicas API → leader-election)
 *  - retry/backoff par calendrier en cas d'erreur
 *  - métriques de sync
 * → migrer vers Bull ou un worker dédié.
 *
 * Les erreurs par calendrier sont stockées dans `last_error`, le worker
 * lui-même ne crash jamais (catch global).
 */
export function startIcalWorker(app: FastifyInstance): () => void {
  const service = new LogementExternalCalendarService(app.db);

  let running = false;
  const tick = async () => {
    if (running) {
      app.log.warn('ical-worker: previous tick still running, skip');
      return;
    }
    running = true;
    try {
      const calendars = await service.findAllEnabled();
      app.log.info(`ical-worker: syncing ${calendars.length} calendar(s)`);
      for (const cal of calendars) {
        try {
          const r = await service.syncCalendar(cal);
          app.log.info(
            { calendar_id: cal.id, provider: cal.provider, ...r },
            'ical-worker: synced',
          );
        } catch (err) {
          app.log.error({ err, calendar_id: cal.id }, 'ical-worker: per-calendar error');
        }
      }
    } catch (err) {
      app.log.error({ err }, 'ical-worker: tick error');
    } finally {
      running = false;
    }
  };

  // Premier run après un petit délai pour laisser le serveur être prêt.
  const initialTimer = setTimeout(() => {
    void tick();
  }, INITIAL_DELAY_MS);
  const interval = setInterval(() => {
    void tick();
  }, SYNC_INTERVAL_MS);

  // Retourne une fonction de cleanup à appeler à l'arrêt (utile pour les tests).
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
