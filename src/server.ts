import buildApp from './app';
import env from './config/env';
import { startIcalWorker } from './lib/ical-worker';

async function start() {
  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    // Lance le worker de sync iCal après que le serveur écoute. Pas de gestion
    // de leader-election : si plusieurs replicas tournent, chacun sync — la
    // contrainte UNIQUE sur (external_source, external_event_uid) empêche les
    // doublons. Suffisant pour MVP.
    startIcalWorker(app);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
