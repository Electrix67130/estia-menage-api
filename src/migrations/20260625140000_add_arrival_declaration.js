/**
 * Déclaration d'arrivée du prestataire :
 * - note des voyageurs (1-5 étoiles),
 * - déclaration d'une dégradation (oui/non) + description,
 * - photos de dégradation (flag is_degradation sur la table photo).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.integer('traveler_rating'); // 1-5, null si non noté
    table.boolean('has_degradation').notNullable().defaultTo(false);
    table.text('degradation_note');
  });
  await knex.schema.alterTable('photo', (table) => {
    table.boolean('is_degradation').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('traveler_rating');
    table.dropColumn('has_degradation');
    table.dropColumn('degradation_note');
  });
  await knex.schema.alterTable('photo', (table) => {
    table.dropColumn('is_degradation');
  });
};
