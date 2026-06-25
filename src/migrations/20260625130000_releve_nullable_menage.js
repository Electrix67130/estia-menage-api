/**
 * Permet un relevé de consommable « manuel » non rattaché à un ménage :
 * un admin peut ainsi fixer/initialiser le stock courant d'un consommable
 * (menage_id = NULL). Le stock courant restant = le relevé le plus récent
 * (ménage ou manuel) — la notif de seuil au pointage prestataire est inchangée.
 */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE menage_consommable_releve ALTER COLUMN menage_id DROP NOT NULL');
};

exports.down = async function (knex) {
  // On supprime les relevés manuels avant de réimposer la contrainte NOT NULL.
  await knex('menage_consommable_releve').whereNull('menage_id').del();
  await knex.raw('ALTER TABLE menage_consommable_releve ALTER COLUMN menage_id SET NOT NULL');
};
