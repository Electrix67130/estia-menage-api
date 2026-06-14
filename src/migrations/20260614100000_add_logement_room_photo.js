exports.up = function (knex) {
  return knex.schema.alterTable('logement_room', (table) => {
    // Photo de couverture de la pièce (URL /files via flow d'upload).
    table.string('photo_url', 500).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('logement_room', (table) => {
    table.dropColumn('photo_url');
  });
};
