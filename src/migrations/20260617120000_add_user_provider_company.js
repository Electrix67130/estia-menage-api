/**
 * Entreprise propre du prestataire (indépendante de `company_name`, qui reste
 * l'entreprise de l'organisation). Affichée/éditée sur le profil du presta.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.string('provider_company', 200).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('provider_company');
  });
};
