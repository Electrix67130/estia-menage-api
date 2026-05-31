/**
 * Pointage géolocalisé : photo + coordonnées GPS prises au moment de l'arrivée
 * et du départ. Sert de preuve que le prestataire était physiquement sur place.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.string('arrival_photo_url', 500).nullable();
    table.decimal('arrival_lat', 10, 7).nullable();
    table.decimal('arrival_lng', 10, 7).nullable();
    table.string('departure_photo_url', 500).nullable();
    table.decimal('departure_lat', 10, 7).nullable();
    table.decimal('departure_lng', 10, 7).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('arrival_photo_url');
    table.dropColumn('arrival_lat');
    table.dropColumn('arrival_lng');
    table.dropColumn('departure_photo_url');
    table.dropColumn('departure_lat');
    table.dropColumn('departure_lng');
  });
};
