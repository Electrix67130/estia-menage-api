/**
 * Verrou de date_prevue contre la sync iCal.
 *
 * Sans ce verrou, quand un admin approuve une demande de changement (ou modifie
 * manuellement la date d'un ménage rattaché à un calendrier Airbnb/Booking),
 * la prochaine sync iCal écrase la nouvelle date avec celle de l'event externe
 * (cf. logement-external-calendar.service `prev.date_prevue !== ev.end_date`).
 *
 * Cette colonne permet à la sync de skipper la mise à jour de la date sur les
 * lignes manuellement verrouillées. L'admin peut déverrouiller via l'UI s'il
 * veut re-synchroniser sur l'iCal.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.boolean('date_locked').notNullable().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('date_locked');
  });
};
