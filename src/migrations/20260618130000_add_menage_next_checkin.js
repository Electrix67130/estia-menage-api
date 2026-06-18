/**
 * Prochain check-in du logement après ce ménage (date d'arrivée du prochain
 * voyageur, issue de la sync iCal). Permet d'afficher la deadline « à faire
 * avant le prochain check-in » et de repérer les rotations le jour même.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.date('next_checkin_at').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('next_checkin_at');
  });
};
