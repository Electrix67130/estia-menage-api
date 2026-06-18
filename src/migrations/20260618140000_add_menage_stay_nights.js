/**
 * Durée du séjour (nb de nuits) du voyageur dont on nettoie après le départ,
 * calculée depuis l'iCal (checkout − checkin). Aide le prestataire à anticiper
 * l'ampleur du ménage (gros séjour = plus de travail).
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.integer('stay_nights').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('stay_nights');
  });
};
