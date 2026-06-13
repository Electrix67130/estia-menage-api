import buildApp from './app';
import env from './config/env';
import { startIcalWorker } from './lib/ical-worker';
import { startReminderWorker } from './lib/reminder-worker';

async function start() {
  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    // Lance le worker de sync iCal après que le serveur écoute. Pas de gestion
    // de leader-election : si plusieurs replicas tournent, chacun sync — la
    // contrainte UNIQUE sur (external_source, external_event_uid) empêche les
    // doublons. Suffisant pour MVP.
    startIcalWorker(app);
    // Worker de rappels push (veille 18h + 2h avant). Même réserve multi-replica
    // que l'iCal : l'anti-doublon repose ici sur reminder_*_sent_at (UPDATE idempotent).
    startReminderWorker(app);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
