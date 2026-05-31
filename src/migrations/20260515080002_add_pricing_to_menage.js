exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    // Prix facturé client (HT) + TVA
    table.decimal('client_price_ht', 10, 2);
    table.decimal('client_vat_rate', 5, 2).defaultTo(20.0);

    // Prix payé prestataire
    table.decimal('provider_price', 10, 2);

    // Devise (hardcodée EUR pour l'instant)
    table.string('currency', 3).defaultTo('EUR');

    // Option linge
    table.boolean('laundry_included').notNullable().defaultTo(false);
    table.decimal('laundry_client_price_ht', 10, 2);
    table.decimal('laundry_provider_price', 10, 2);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('client_price_ht');
    table.dropColumn('client_vat_rate');
    table.dropColumn('provider_price');
    table.dropColumn('currency');
    table.dropColumn('laundry_included');
    table.dropColumn('laundry_client_price_ht');
    table.dropColumn('laundry_provider_price');
  });
};
