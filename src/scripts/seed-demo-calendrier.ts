/**
 * Enrichit le compte de démonstration d'un mois de réservations.
 *
 *   npm run seed:demo:calendrier
 *
 * Le jeu de base suffit à montrer une prestation, pas un planning : cinq
 * interventions sur trois semaines donnent un calendrier vide, alors que c'est
 * précisément la densité qui montre à quoi sert l'application.
 *
 * Chaque réservation produit trois prestations partageant un `external_event_uid`
 * — check-in à l'arrivée, ménage au départ (porteur de `stay_nights`), check-out
 * le même jour. C'est ce triplet que la vue « Séjours » regroupe en une barre
 * allant de l'arrivée au départ.
 *
 * Idempotent : les lignes déjà générées (reconnaissables à `external_source`)
 * sont supprimées avant régénération. Le reste du jeu de démo — logements,
 * photos, équipements — n'est pas touché.
 */
import knex from 'knex';
import bcrypt from 'bcrypt';
import knexConfig from '@/config/knexfile';
import { generateChecklistForMenage } from '@/modules/menage-check/menage-check.service';
import type { LogementRow } from '@/modules/logement/logement.schema';

const NOM_ORG = 'Estia Démo (Apple Review)';
const SOURCE = 'demo_calendrier';

/** Date décalée de `jours`, au format YYYY-MM-DD, en heure locale. */
function jour(decalage: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jourDuMois = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jourDuMois}`;
}

/**
 * Séjours étalés autour d'aujourd'hui : quelques-uns passés (l'historique n'est
 * pas vide), la majorité à venir. Les durées varient — un week-end, une semaine —
 * pour que les barres n'aient pas toutes la même longueur.
 */
const SEJOURS = [
  { logement: 0, arrivee: -12, nuits: 3 },
  { logement: 1, arrivee: -9, nuits: 2 },
  { logement: 0, arrivee: -6, nuits: 4 },
  { logement: 1, arrivee: -3, nuits: 5 },
  { logement: 0, arrivee: 0, nuits: 2 },
  { logement: 1, arrivee: 2, nuits: 3 },
  { logement: 0, arrivee: 5, nuits: 7 },
  { logement: 1, arrivee: 8, nuits: 2 },
  { logement: 0, arrivee: 13, nuits: 4 },
  { logement: 1, arrivee: 16, nuits: 3 },
];

async function main(): Promise<void> {
  const db = knex(knexConfig);
  try {
    const org = await db('organization').where({ name: NOM_ORG }).first();
    if (!org) throw new Error(`Organisation « ${NOM_ORG} » introuvable : lancez d'abord npm run seed:demo`);

    const admin = await db('user').where({ email: 'demo.admin@estia-clean-connect.fr' }).first();
    const presta = await db('user').where({ email: 'demo.presta@estia-clean-connect.fr' }).first();
    if (!admin || !presta) throw new Error('Comptes de démonstration introuvables');

    const logements = (await db('logement')
      .where({ organization_id: org.id })
      .orderBy('created_at', 'asc')) as LogementRow[];
    if (logements.length < 2) throw new Error('Logements de démonstration introuvables');

    // Deux prestataires de plus (même mot de passe que les comptes démo) : sans
    // eux, l'admin n'a personne à choisir et la vue « qui est dispo ? » est vide.
    const hash = await bcrypt.hash('DemoEstia2026!', 10);
    const collegue = async (email: string, prenom: string, nom: string) => {
      let u = await db('user').where({ email }).first();
      if (!u) {
        [u] = await db('user')
          .insert({
            email,
            password_hash: hash,
            first_name: prenom,
            last_name: nom,
            phone: '0600000000',
            role: 'prestataire',
            organization_id: org.id,
            active_organization_id: org.id,
            is_active: true,
          })
          .returning('*');
      }
      const membre = await db('organization_member').where({ organization_id: org.id, user_id: u.id }).first();
      if (!membre) await db('organization_member').insert({ organization_id: org.id, user_id: u.id, role: 'prestataire' });
      for (const l of logements) {
        const lm = await db('logement_member').where({ logement_id: l.id, user_id: u.id }).first();
        if (!lm) await db('logement_member').insert({ logement_id: l.id, user_id: u.id, role: 'prestataire' });
      }
      return u as { id: string };
    };
    const sofia = await collegue('demo.presta2@estia-clean-connect.fr', 'Sofia', 'Benali');
    const karim = await collegue('demo.presta3@estia-clean-connect.fr', 'Karim', 'Lefèvre');

    // Repartir de zéro sur les seules lignes générées ici.
    const anciens = (await db('menage')
      .where({ organization_id: org.id, external_source: SOURCE })
      .select('id')) as { id: string }[];
    if (anciens.length > 0) {
      const ids = anciens.map((m) => m.id);
      await db('menage_prestataire').whereIn('menage_id', ids).del();
      await db('menage_response').whereIn('menage_id', ids).del();
      await db('menage').whereIn('id', ids).del();
      console.log(`${ids.length} prestation(s) générée(s) précédemment supprimée(s).`);
    }

    let creees = 0;
    for (const [index, sejour] of SEJOURS.entries()) {
      const logement = logements[sejour.logement];
      const arrivee = jour(sejour.arrivee);
      const depart = jour(sejour.arrivee + sejour.nuits);
      const uid = `${SOURCE}-${index}`;
      // Un séjour au départ passé est déjà fait ; les autres sont à venir.
      const passe = sejour.arrivee + sejour.nuits < 0;
      // Passé : tout a été fait par la prestataire de démonstration. Le plus
      // ancien est validé (historique), les suivants sont **terminés mais pas
      // encore validés** → l'admin a quelque chose dans « À valider ».
      const aValider = passe && index > 0;
      // À venir : deux séjours sur trois sont confiés à la prestataire, les
      // autres restent à pourvoir avec des votes différents (un où deux
      // collègues sont dispo, un où tout le monde a dit absent, un sans réponse)
      // pour que la vue « qui est dispo ? » montre ses trois états.
      const affecte = passe || (index % 3 !== 2 && index !== 7);
      const votes: Array<{ user: { id: string }; status: 'present' | 'absent' }> =
        index === 5
          ? [{ user: presta, status: 'present' }, { user: sofia, status: 'present' }, { user: karim, status: 'absent' }]
          : index === 8
            ? [{ user: presta, status: 'absent' }, { user: karim, status: 'absent' }]
            : [];

      const prestations = [
        { type: 'check_in' as const, date: arrivee, nuits: null as number | null },
        { type: 'menage' as const, date: depart, nuits: sejour.nuits },
        { type: 'check_out' as const, date: depart, nuits: null as number | null },
      ];

      for (const p of prestations) {
        const estMenage = p.type === 'menage';
        const [menage] = (await db('menage')
          .insert({
            logement_id: logement.id,
            organization_id: org.id,
            created_by: admin.id,
            prestataire_user_id: affecte ? presta.id : null,
            prestation_type: p.type,
            status: aValider ? 'termine' : passe ? 'valide' : 'a_venir',
            date_prevue: p.date,
            stay_nights: p.nuits,
            next_checkin_at: estMenage ? depart : null,
            horaire_prevu: p.type === 'check_in' ? '16:00' : p.type === 'check_out' ? '10:00' : '11:00',
            duree_estimee_min: estMenage ? 120 : 30,
            client_price_ht: estMenage ? 90 : null,
            provider_price: estMenage ? 55 : null,
            n_lit_double: estMenage ? 1 : 0,
            n_travelers: 2 + (index % 3),
            external_source: SOURCE,
            external_event_uid: uid,
            ...(passe
              ? {
                  arrived_at: new Date(`${p.date}T08:05:00Z`),
                  departed_at: new Date(`${p.date}T10:10:00Z`),
                  date_realisation: p.date,
                  ...(aValider
                    ? { traveler_rating: 4 }
                    : {
                        validated_at: new Date(`${p.date}T18:00:00Z`),
                        validated_by: admin.id,
                        validated_price: estMenage ? 90 : null,
                      }),
                }
              : {}),
          })
          .returning('*')) as { id: string }[];

        if (affecte) {
          await db('menage_prestataire').insert({ menage_id: menage.id, user_id: presta.id });
        }
        for (const v of votes) {
          await db('menage_response').insert({ menage_id: menage.id, user_id: v.user.id, status: v.status });
        }
        // Seuls les ménages portent une checklist : un check-in n'en a pas.
        if (estMenage) {
          await db.transaction((trx) => generateChecklistForMenage(trx, menage.id, logement));
        }
        creees++;
      }
    }

    console.log(`\n${SEJOURS.length} séjours · ${creees} prestations créées.`);
    console.log(`Du ${jour(-12)} au ${jour(19)}.\n`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Échec :', err);
  process.exit(1);
});
