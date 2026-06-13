exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    // Horodatage d'envoi des rappels push, pour ne jamais les renvoyer.
    table.timestamp('reminder_eve_sent_at').nullable(); // rappel veille 18h (ou relance si non assigné)
    table.timestamp('reminder_2h_sent_at').nullable(); // rappel 2h avant l'heure prévue
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('reminder_eve_sent_at');
    table.dropColumn('reminder_2h_sent_at');
  });
};
