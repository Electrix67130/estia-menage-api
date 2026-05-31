/**
 * Ajoute une couleur au logement, utilisée pour différencier visuellement les
 * ménages dans le calendrier. Format attendu : code hex `#RRGGBB`.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('logement', (table) => {
    table.string('color', 9).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('logement', (table) => {
    table.dropColumn('color');
  });
};
