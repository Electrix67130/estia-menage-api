/**
 * Infos de facturation de l'entreprise propre du prestataire (en plus de
 * `provider_company`). Renseignées via lookup SIRET, éditables par le presta.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.string('provider_siret', 20).nullable();
    table.string('provider_vat_number', 20).nullable();
    table.string('provider_address', 300).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('provider_siret');
    table.dropColumn('provider_vat_number');
    table.dropColumn('provider_address');
  });
};
