/**
 * Discriminateur de type de prestation sur `menage`.
 *
 * La table `menage` devient le support générique d'une « prestation » datée :
 * - 'menage'    : le ménage classique (défaut, rétro-compat total)
 * - 'check_in'  : accueil / remise de clés à l'arrivée du voyageur
 * - 'check_out' : état des lieux / inventaire au départ du voyageur
 *
 * Tout le reste (assignation `menage_prestataire`, réponses présent/absent
 * `menage_response`, pointage géolocalisé arrivée/départ, photos, commentaires,
 * permissions par logement) est réutilisé tel quel quel que soit le type.
 *
 * Le nom de la table reste `menage` (« prestation » n'est qu'un terme UI).
 */
exports.up = async function (knex) {
  await knex.raw(
    `CREATE TYPE menage_prestation_type AS ENUM ('menage', 'check_in', 'check_out')`,
  );
  await knex.schema.alterTable('menage', (table) => {
    table
      .enu('prestation_type', ['menage', 'check_in', 'check_out'], {
        useNative: true,
        existingType: true,
        enumName: 'menage_prestation_type',
      })
      .notNullable()
      .defaultTo('menage');
    // Filtrage par type dans la worklist active (dashboard : menus séparés ;
    // mobile : onglet « Prestations » qui liste les 3 types).
    table.index(
      ['organization_id', 'prestation_type', 'status'],
      'idx_menage_org_type_status',
    );
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropIndex(
      ['organization_id', 'prestation_type', 'status'],
      'idx_menage_org_type_status',
    );
    table.dropColumn('prestation_type');
  });
  await knex.raw('DROP TYPE IF EXISTS menage_prestation_type');
};
