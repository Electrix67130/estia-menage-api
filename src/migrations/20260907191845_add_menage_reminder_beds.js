/**
 * Anti-doublon de l'alerte admin « Lits à renseigner » (veille 9h).
 * Colonne dédiée : cette alerte a sa propre heure d'envoi, indépendante du
 * rappel prestataire de 18h (`reminder_eve_sent_at`).
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.timestamp('reminder_beds_sent_at').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('reminder_beds_sent_at');
  });
};
