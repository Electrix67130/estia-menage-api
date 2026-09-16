import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createLogement, createOrgWithAdmin, type TestUser } from '../helpers/factories';
import { calendrier, reservation, simulerFluxIcal, type FluxSimule } from '../helpers/ical';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

const URL_FLUX = 'https://exemple.test/calendrier.ics';

let flux: FluxSimule;
beforeEach(async () => {
  await truncateAll(app.db);
});
afterEach(() => flux?.restore());

interface Contexte {
  organizationId: string;
  admin: TestUser;
  logementId: string;
  calendrierId: string;
}

async function contexte(
  contenu: string,
  options: { checkIn?: boolean; checkOut?: boolean } = {},
): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id });
  await app.db('logement').where({ id: logementId }).update({
    default_duration_min: 120,
    default_client_price_ht: 90,
    default_provider_price: 55,
    default_horaire_debut: '10:00',
    enable_check_in: options.checkIn ?? false,
    enable_check_out: options.checkOut ?? false,
  });

  flux = simulerFluxIcal(URL_FLUX, contenu);

  const res = await app.inject({
    method: 'POST',
    url: '/logement-external-calendars',
    headers: auth(admin.token),
    payload: { logement_id: logementId, provider: 'airbnb', url: URL_FLUX },
  });
  if (res.statusCode !== 201) throw new Error(`Création du calendrier : ${res.statusCode} ${res.body}`);

  return { organizationId, admin, logementId, calendrierId: res.json().id };
}

async function synchroniser(ctx: Contexte) {
  const res = await app.inject({
    method: 'POST',
    url: `/logement-external-calendars/${ctx.calendrierId}/sync`,
    headers: auth(ctx.admin.token),
  });
  return res.json();
}

/** Les prestations du logement, triées, avec leur jour lisible. */
async function prestations(ctx: Contexte) {
  return app
    .db('menage')
    .where({ logement_id: ctx.logementId })
    .orderBy('date_prevue', 'asc')
    .select(
      'id',
      'prestation_type',
      'status',
      'stay_nights',
      'external_event_uid',
      'sync_ignored',
      'date_locked',
      app.db.raw("to_char(date_prevue, 'YYYY-MM-DD') as jour"),
      app.db.raw("to_char(next_checkin_at, 'YYYY-MM-DD') as prochain_checkin"),
    );
}

describe('création des prestations', () => {
  it('programme le ménage au jour du départ, avec les valeurs du logement', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );

    const resultat = await synchroniser(ctx);
    expect(resultat).toMatchObject({ fetched_events: 1, created_menages: 1 });

    const [menage] = await prestations(ctx);
    expect(menage).toMatchObject({
      prestation_type: 'menage',
      status: 'a_venir',
      jour: '2026-07-14',
      stay_nights: 4,
      external_event_uid: 'resa-1',
    });

    const complet = await app.db('menage').where({ id: menage.id }).first();
    expect(Number(complet.client_price_ht)).toBe(90);
    expect(Number(complet.provider_price)).toBe(55);
    expect(complet.duree_estimee_min).toBe(120);
  });

  it('engendre la checklist du ménage créé', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);

    const [menage] = await prestations(ctx);
    const sections = await app.db('menage_check_section').where({ menage_id: menage.id });
    expect(sections.length).toBeGreaterThan(0);
  });

  it('ajoute check-in et check-out quand le logement les active', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
      { checkIn: true, checkOut: true },
    );
    await synchroniser(ctx);

    const lignes = await prestations(ctx);
    expect(lignes).toHaveLength(3);
    expect(lignes.find((l) => l.prestation_type === 'check_in')).toMatchObject({ jour: '2026-07-10' });
    expect(lignes.find((l) => l.prestation_type === 'check_out')).toMatchObject({ jour: '2026-07-14' });
    // Les trois partagent la réservation : c'est ce qui permet de tracer un séjour.
    expect(new Set(lignes.map((l) => l.external_event_uid)).size).toBe(1);
  });

  it('renseigne le prochain check-in pour préparer la rotation', async () => {
    const ctx = await contexte(
      calendrier(
        reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' }),
        reservation({ debut: '2026-07-14', fin: '2026-07-18', uid: 'resa-2' }),
      ),
    );
    await synchroniser(ctx);

    const lignes = await prestations(ctx);
    // Rotation le jour même : le ménage du 14 est suivi d'une arrivée le 14.
    expect(lignes[0]).toMatchObject({ jour: '2026-07-14', prochain_checkin: '2026-07-14' });
  });

  it('ignore un blocage de dates Airbnb', async () => {
    const ctx = await contexte(
      calendrier(
        reservation({
          debut: '2026-07-10',
          fin: '2026-07-14',
          uid: 'bloc-1',
          summary: 'Airbnb (Not available)',
        }),
      ),
    );

    const resultat = await synchroniser(ctx);
    expect(resultat.fetched_events).toBe(1);
    expect(resultat.created_menages).toBe(0);
    expect(await prestations(ctx)).toHaveLength(0);
  });

  it('retient une réservation sans UID — le cas des ré-exports', async () => {
    // Certains flux (Cozysmart/PassPass) n'émettent pas d'UID. Sans repli, leurs
    // réservations étaient ignorées en silence : aucun ménage créé.
    const ctx = await contexte(
      calendrier(
        reservation({
          debut: '2026-07-10',
          fin: '2026-07-14',
          summary: '63fcf5b7-0c2e-42f1-b0c1-3cd834bc3aa8',
        }),
      ),
    );

    const resultat = await synchroniser(ctx);
    expect(resultat.created_menages).toBe(1);
    const [menage] = await prestations(ctx);
    expect(menage.external_event_uid).toBe('63fcf5b7-0c2e-42f1-b0c1-3cd834bc3aa8');
  });
});

describe('synchronisations successives', () => {
  it('ne recrée pas ce qui existe déjà', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);
    const seconde = await synchroniser(ctx);

    expect(seconde.created_menages).toBe(0);
    expect(await prestations(ctx)).toHaveLength(1);
  });

  it('déplace le ménage quand la réservation change de dates', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);

    flux.servir(calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-16', uid: 'resa-1' })));
    const resultat = await synchroniser(ctx);

    expect(resultat.updated_menages).toBe(1);
    const [menage] = await prestations(ctx);
    expect(menage).toMatchObject({ jour: '2026-07-16', stay_nights: 6 });
  });

  it('annule la prestation quand la réservation disparaît du flux', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);

    flux.servir(calendrier());
    const resultat = await synchroniser(ctx);

    expect(resultat.cancelled_menages).toBe(1);
    const [menage] = await prestations(ctx);
    // Annulée, pas supprimée : l'historique doit rester lisible.
    expect(menage.status).toBe('annule');
  });

  it('réactive une prestation dont la réservation revient', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);
    flux.servir(calendrier());
    await synchroniser(ctx);

    flux.servir(calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })));
    await synchroniser(ctx);

    const lignes = await prestations(ctx);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].status).toBe('a_venir');
  });

  it('respecte une date verrouillée à la main', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);
    const [avant] = await prestations(ctx);
    // L'admin a déplacé la prestation et verrouillé la date : la synchro ne doit
    // plus l'écraser, sinon le report accordé au prestataire serait perdu.
    await app.db('menage').where({ id: avant.id }).update({ date_prevue: '2026-07-15', date_locked: true });

    flux.servir(calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-20', uid: 'resa-1' })));
    await synchroniser(ctx);

    const [apres] = await prestations(ctx);
    expect(apres.jour).toBe('2026-07-15');
  });

  it('ne ressuscite jamais une prestation retirée par l’admin', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);
    const [menage] = await prestations(ctx);
    // « Retirer » marque la prestation ignorée plutôt que de la supprimer :
    // une suppression sèche serait recréée à la synchro suivante.
    await app.db('menage').where({ id: menage.id }).update({ sync_ignored: true, status: 'annule' });

    await synchroniser(ctx);

    const lignes = await prestations(ctx);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ status: 'annule', sync_ignored: true });
  });
});

describe('pannes du flux', () => {
  it('signale l’erreur sans rien casser', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    await synchroniser(ctx);

    flux.echouer(404);
    const resultat = await synchroniser(ctx);

    expect(resultat.error).toContain('404');
    expect(resultat.created_menages).toBe(0);
    // La panne ne doit pas annuler les prestations déjà créées.
    const lignes = await prestations(ctx);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].status).toBe('a_venir');

    const calendrierEnBase = await app.db('logement_external_calendar').where({ id: ctx.calendrierId }).first();
    expect(calendrierEnBase.last_error).toContain('404');
  });

  it('est réservée à l’admin', async () => {
    const ctx = await contexte(
      calendrier(reservation({ debut: '2026-07-10', fin: '2026-07-14', uid: 'resa-1' })),
    );
    const { admin: autreAdmin } = await createOrgWithAdmin(app, 'Conciergerie B');

    const res = await app.inject({
      method: 'POST',
      url: `/logement-external-calendars/${ctx.calendrierId}/sync`,
      headers: auth(autreAdmin.token),
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
