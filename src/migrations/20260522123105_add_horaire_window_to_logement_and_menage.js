/**
 * Tranche horaire d'intervention :
 *  - sur `logement` : valeurs par défaut (admin configure une fois)
 *  - sur `menage` : `horaire_prevu` existait déjà (= début) ; on ajoute
 *    `horaire_fin_prevu` pour matérialiser la fin de la tranche.
 *
 * Format : varchar(8) pour matcher l'existant `horaire_prevu` (HH:MM[:SS]).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.string('default_horaire_debut', 8).nullable();
    table.string('default_horaire_fin', 8).nullable();
  });
  await knex.schema.alterTable('menage', (table) => {
    table.string('horaire_fin_prevu', 8).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('horaire_fin_prevu');
  });
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('default_horaire_fin');
    table.dropColumn('default_horaire_debut');
  });
};
