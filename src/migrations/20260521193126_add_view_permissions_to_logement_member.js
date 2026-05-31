/**
 * Permissions granulaires de visibilité sur les autres membres d'un logement.
 *
 * Un prestataire est par défaut "discret" : il ne voit pas les autres
 * prestataires du logement, ni les responsables (managers), ni le client de
 * facturation. Un admin peut élargir au cas par cas via ces 3 booléens.
 *
 * Pour les autres rôles (manager / client_proprietaire), defaults à true
 * — pas de raison de leur cacher l'équipe par défaut.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement_member', (table) => {
    table.boolean('can_view_prestataires').notNullable().defaultTo(false);
    table.boolean('can_view_responsables').notNullable().defaultTo(false);
    table.boolean('can_view_clients').notNullable().defaultTo(false);
  });

  // Backfill : pour les non-prestataires (manager / client_proprietaire), on
  // ouvre tout par défaut. Pour les prestataires existants, on garde false.
  await knex('logement_member').whereNot('role', 'prestataire').update({
    can_view_prestataires: true,
    can_view_responsables: true,
    can_view_clients: true,
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement_member', (table) => {
    table.dropColumn('can_view_prestataires');
    table.dropColumn('can_view_responsables');
    table.dropColumn('can_view_clients');
  });
};
