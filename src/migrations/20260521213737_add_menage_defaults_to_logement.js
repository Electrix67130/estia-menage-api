/**
 * Valeurs par défaut au niveau logement, utilisées pour pré-remplir le
 * formulaire de création d'un ménage. L'admin peut toujours surcharger
 * ces valeurs à la création du ménage.
 *
 * - default_duration_min : durée estimée moyenne (en minutes)
 * - default_client_price_ht : prix facturé au client par défaut (HT)
 * - default_client_vat_rate : taux TVA % par défaut (default 20)
 * - default_provider_price : prix payé au prestataire par défaut
 * - default_laundry_included : le linge est inclus par défaut sur les ménages
 *   de ce logement
 * - default_laundry_client_price_ht / default_laundry_provider_price :
 *   tarifs linge par défaut
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.integer('default_duration_min').nullable();
    table.decimal('default_client_price_ht', 10, 2).nullable();
    table.decimal('default_client_vat_rate', 5, 2).nullable();
    table.decimal('default_provider_price', 10, 2).nullable();
    table.boolean('default_laundry_included').notNullable().defaultTo(false);
    table.decimal('default_laundry_client_price_ht', 10, 2).nullable();
    table.decimal('default_laundry_provider_price', 10, 2).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('default_laundry_provider_price');
    table.dropColumn('default_laundry_client_price_ht');
    table.dropColumn('default_laundry_included');
    table.dropColumn('default_provider_price');
    table.dropColumn('default_client_vat_rate');
    table.dropColumn('default_client_price_ht');
    table.dropColumn('default_duration_min');
  });
};
