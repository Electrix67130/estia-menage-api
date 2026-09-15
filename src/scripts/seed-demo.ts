/**
 * Compte de démonstration pour la revue Apple.
 *
 *   npm run seed:demo
 *
 * L'application est entièrement derrière un écran de connexion : un relecteur
 * qui ne peut pas entrer rejette la soumission. Ce script crée une organisation
 * isolée, deux comptes (admin et prestataire) et de quoi voir l'app vivante —
 * logements, pièces, checklist, équipements, codes d'accès, et des prestations
 * dans chaque état du cycle.
 *
 * Idempotent : il supprime l'organisation de démo existante avant de la
 * recréer. Les données réelles ne sont jamais touchées — tout est rattaché à
 * une organisation dédiée, reconnaissable à son nom.
 *
 * Les identifiants sont affichés en fin d'exécution : ce sont eux à recopier
 * dans App Store Connect, section « Informations pour la connexion ».
 */
import bcrypt from 'bcrypt';
import knex from 'knex';
import knexConfig from '@/config/knexfile';

const NOM_ORG = 'Estia Démo (Apple Review)';
const EMAIL_ADMIN = 'demo.admin@estia-clean-connect.fr';
const EMAIL_PRESTA = 'demo.presta@estia-clean-connect.fr';
const MOT_DE_PASSE = 'DemoEstia2026!';
// Le coût de production : le compte doit se connecter comme n'importe quel autre.
const SALT_ROUNDS = 12;

/** Date décalée de `jours` par rapport à aujourd'hui, au format YYYY-MM-DD. */
function jour(decalage: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jourDuMois = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jourDuMois}`;
}

async function main(): Promise<void> {
  const db = knex(knexConfig);
  try {
    // --- Repartir d'une ardoise propre -------------------------------------
    const existante = await db('organization').where({ name: NOM_ORG }).first();
    const anciens = (await db('user')
      .whereIn('email', [EMAIL_ADMIN, EMAIL_PRESTA])
      .select('id')) as { id: string }[];

    if (existante || anciens.length > 0) {
      // Ordre imposé par le graphe des clés étrangères :
      // supprimer l'organisation emporte SES COMPTES en cascade
      // (`user.organization_id`), et ces comptes sont retenus par les lignes
      // nominatives qui, elles, ne cascadent pas (commentaires, photos,
      // validations de checklist). On retire donc ces traces d'abord.
      const ids = anciens.map((c) => c.id);
      if (ids.length > 0) {
        await db('comment').whereIn('author_id', ids).del();
        await db('photo').whereIn('uploaded_by', ids).del();
        await db('menage_prestataire').whereIn('user_id', ids).del();
        await db('menage_check_item').whereIn('validated_by', ids).update({ validated_by: null });
        await db('menage').whereIn('validated_by', ids).update({ validated_by: null });
        await db('menage').whereIn('prestataire_user_id', ids).update({ prestataire_user_id: null });
        await db('refresh_token').whereIn('user_id', ids).del();
        await db('device_token').whereIn('user_id', ids).del();
      }
      if (existante) await db('organization').where({ id: existante.id }).del();
      await db('user').whereIn('email', [EMAIL_ADMIN, EMAIL_PRESTA]).del();
      console.log('Données de démo précédentes supprimées.');
    }

    const [org] = await db('organization')
      .insert({ name: NOM_ORG, is_active: true })
      .returning('*');

    const hash = await bcrypt.hash(MOT_DE_PASSE, SALT_ROUNDS);
    const compte = async (email: string, prenom: string, nom: string, role: string) => {
      const [u] = await db('user')
        .insert({
          email,
          password_hash: hash,
          first_name: prenom,
          last_name: nom,
          phone: '0600000000',
          role,
          organization_id: org.id,
          active_organization_id: org.id,
          is_active: true,
        })
        .returning('*');
      await db('organization_member').insert({
        organization_id: org.id,
        user_id: u.id,
        role,
      });
      return u;
    };

    const admin = await compte(EMAIL_ADMIN, 'Camille', 'Martin', 'admin');
    const presta = await compte(EMAIL_PRESTA, 'Léa', 'Dubois', 'prestataire');

    // --- Un client, pour que la facturation ait du sens --------------------
    const [client] = await db('client')
      .insert({
        organization_id: org.id,
        created_by: admin.id,
        company_name: 'Riviera Locations',
        email: 'contact@riviera-locations.example',
        city: 'Nice',
      })
      .returning('*');

    // --- Deux logements ----------------------------------------------------
    const logements = [
      {
        name: 'Villa des Oliviers',
        address: '12 chemin des Oliviers',
        city: 'Nice',
        postal_code: '06000',
        n_bedrooms: 3,
        n_bathrooms: 2,
        n_lit_double: 2,
        n_lit_simple: 2,
        n_lit_parapluie: 1,
        color: '#2563EB',
      },
      {
        name: 'Studio Vieux-Port',
        address: '4 rue Sainte',
        city: 'Marseille',
        postal_code: '13001',
        n_bedrooms: 1,
        n_bathrooms: 1,
        n_lit_double: 1,
        color: '#0D9488',
      },
    ];

    const crees: { id: string; name: string }[] = [];
    for (const l of logements) {
      const [row] = await db('logement')
        .insert({
          ...l,
          organization_id: org.id,
          created_by: admin.id,
          client_id: client.id,
          default_duration_min: 120,
          default_client_price_ht: 90,
          default_provider_price: 55,
          default_horaire_debut: '10:00',
        })
        .returning('*');
      crees.push({ id: row.id, name: row.name });

      // Le prestataire est membre des deux logements.
      await db('logement_member').insert({
        logement_id: row.id,
        user_id: presta.id,
        role: 'prestataire',
      });

      // Pièces, modèle de checklist, équipements, options, codes d'accès :
      // ce sont eux qui donnent à l'app son aspect « déjà utilisée ».
      const pieces = ['Cuisine', 'Salle de bain', 'Chambre', 'Salon'];
      for (const [i, nom] of pieces.entries()) {
        await db('logement_room').insert({ logement_id: row.id, name: nom, position: i });
      }

      const [sectionCuisine] = await db('logement_check_template_section')
        .insert({ logement_id: row.id, label: 'Cuisine', icon: '🍽️', position: 0 })
        .returning('*');
      await db('logement_check_template_item').insert([
        { section_id: sectionCuisine.id, label: 'Vider et nettoyer le réfrigérateur', position: 0 },
        { section_id: sectionCuisine.id, label: 'Lancer le lave-vaisselle', position: 1 },
        { section_id: sectionCuisine.id, label: 'Nettoyer les plaques', position: 2 },
      ]);
      const [sectionSdb] = await db('logement_check_template_section')
        .insert({ logement_id: row.id, label: 'Salle de bain', icon: '🚿', position: 1 })
        .returning('*');
      await db('logement_check_template_item').insert([
        { section_id: sectionSdb.id, label: 'Désinfecter la douche', position: 0 },
        { section_id: sectionSdb.id, label: 'Remplacer les serviettes', position: 1 },
      ]);

      await db('logement_equipement').insert([
        { logement_id: row.id, label: 'Lave-vaisselle', category: 'electromenager', position: 0 },
        { logement_id: row.id, label: 'Appareil à raclette', category: 'cuisine', position: 1 },
        { logement_id: row.id, label: 'Chaise haute', category: 'bebe', position: 2 },
      ]);
      await db('logement_option').insert([
        {
          logement_id: row.id,
          label: 'Pack romantique',
          description: 'Pétales sur le lit, bougies, champagne au frais',
          position: 0,
        },
      ]);
      await db('logement_code').insert([
        { logement_id: row.id, label: 'Boîte à clés', code: '1984', position: 0 },
        { logement_id: row.id, label: 'Portail', code: 'A12B', position: 1 },
      ]);
      await db('logement').where({ id: row.id }).update({ key_safe_code: '1984' });

      await db('logement_consommable').insert([
        { logement_id: row.id, label: 'Papier toilette', unit: 'rouleaux', seuil_alerte: 4, position: 0 },
        { logement_id: row.id, label: 'Liquide vaisselle', unit: 'flacons', seuil_alerte: 1, position: 1 },
      ]);
    }

    // --- Des prestations dans chaque état ----------------------------------
    const prestations = [
      { logement: 0, date: jour(1), status: 'a_venir', type: 'menage', affecte: true },
      { logement: 0, date: jour(3), status: 'a_venir', type: 'check_in', affecte: true },
      { logement: 1, date: jour(2), status: 'a_venir', type: 'menage', affecte: false },
      { logement: 1, date: jour(-1), status: 'termine', type: 'menage', affecte: true },
      { logement: 0, date: jour(-4), status: 'valide', type: 'menage', affecte: true },
    ];

    for (const p of prestations) {
      const logement = crees[p.logement];
      const [menage] = await db('menage')
        .insert({
          logement_id: logement.id,
          organization_id: org.id,
          created_by: admin.id,
          prestataire_user_id: p.affecte ? presta.id : null,
          prestation_type: p.type,
          status: p.status,
          date_prevue: p.date,
          horaire_prevu: '10:00',
          duree_estimee_min: 120,
          client_price_ht: 90,
          provider_price: 55,
          n_lit_double: 1,
          n_travelers: 2,
          ...(p.status === 'termine' || p.status === 'valide'
            ? {
                arrived_at: new Date(`${p.date}T08:05:00Z`),
                departed_at: new Date(`${p.date}T10:10:00Z`),
                date_realisation: p.date,
                traveler_rating: 4,
              }
            : {}),
          ...(p.status === 'valide'
            ? { validated_at: new Date(`${p.date}T18:00:00Z`), validated_by: admin.id, validated_price: 90 }
            : {}),
        })
        .returning('*');

      if (p.affecte) {
        await db('menage_prestataire').insert({ menage_id: menage.id, user_id: presta.id });
      }

      // Checklist : copiée du modèle du logement, comme le fait la création réelle.
      const sections = await db('logement_check_template_section')
        .where({ logement_id: logement.id })
        .orderBy('position', 'asc');
      for (const [i, tpl] of sections.entries()) {
        const [section] = await db('menage_check_section')
          .insert({
            menage_id: menage.id,
            section_type: 'general',
            section_label: tpl.label,
            icon: tpl.icon,
            position: i,
          })
          .returning('*');
        const items = await db('logement_check_template_item')
          .where({ section_id: tpl.id })
          .orderBy('position', 'asc');
        for (const [j, item] of items.entries()) {
          // Sur les prestations achevées, la checklist est cochée : c'est ainsi
          // que le relecteur voit le résultat d'un ménage, pas un écran vierge.
          const achevee = p.status === 'termine' || p.status === 'valide';
          await db('menage_check_item').insert({
            section_id: section.id,
            item_label: item.label,
            position: j,
            validated_at: achevee ? new Date(`${p.date}T09:30:00Z`) : null,
            validated_by: achevee ? presta.id : null,
          });
        }
      }

      // Options retenues et équipements à préparer : sans eux, deux sections du
      // détail restent masquées, et le relecteur ne voit pas ces fonctionnalités.
      if (p.status === 'a_venir' && p.type === 'menage') {
        const equipements = (await db('logement_equipement')
          .where({ logement_id: logement.id })
          .whereIn('label', ['Chaise haute', 'Appareil à raclette'])
          .select('id')) as { id: string }[];
        if (equipements.length > 0) {
          await db('menage_equipement').insert(
            equipements.map((e) => ({ menage_id: menage.id, logement_equipement_id: e.id })),
          );
        }
        const option = (await db('logement_option')
          .where({ logement_id: logement.id, label: 'Pack romantique' })
          .first()) as { id: string } | undefined;
        if (option) {
          await db('menage_option').insert({
            menage_id: menage.id,
            logement_option_id: option.id,
            notes: 'Arrivée prévue vers 18 h',
          });
        }
      }

      if (p.status === 'termine') {
        await db('comment').insert({
          menage_id: menage.id,
          author_id: presta.id,
          content: 'Ménage terminé. Le lave-vaisselle a mis du temps à finir son cycle.',
        });
      }
    }

    console.log('\n--- Compte de démonstration prêt ---');
    console.log(`Organisation : ${NOM_ORG}`);
    console.log(`Admin        : ${EMAIL_ADMIN} / ${MOT_DE_PASSE}`);
    console.log(`Prestataire  : ${EMAIL_PRESTA} / ${MOT_DE_PASSE}`);
    console.log(`Logements    : ${crees.map((l) => l.name).join(', ')}`);
    console.log(`Prestations  : ${prestations.length}\n`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Échec du seed de démonstration :', err);
  process.exit(1);
});
