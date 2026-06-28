/**
 * Nombre de voyageurs pour un ménage (saisi par l'admin ; l'iCal ne le fournit
 * pas de façon fiable). Sert à dimensionner les « lits à faire ».
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.integer('n_travelers'); // nullable : non renseigné par défaut
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('n_travelers');
  });
};
