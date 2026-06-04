/**
 * Détail des couchages par type sur logement (defaults) et menage (effectif).
 *
 * - Sur `logement` : valeurs par défaut du bien, utilisées comme template.
 * - Sur `menage` : valeurs effectives pour ce ménage spécifique. Copiées depuis
 *   le logement à la création (cf. menage.service) puis éditables par l'admin
 *   (saisonnalité, demande spéciale). Lecture seule côté prestataire.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.integer('n_lit_simple').notNullable().defaultTo(0);
    table.integer('n_lit_double').notNullable().defaultTo(0);
    table.integer('n_canape_lit').notNullable().defaultTo(0);
    table.integer('n_lit_appoint').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('menage', (table) => {
    table.integer('n_lit_simple').notNullable().defaultTo(0);
    table.integer('n_lit_double').notNullable().defaultTo(0);
    table.integer('n_canape_lit').notNullable().defaultTo(0);
    table.integer('n_lit_appoint').notNullable().defaultTo(0);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('n_lit_simple');
    table.dropColumn('n_lit_double');
    table.dropColumn('n_canape_lit');
    table.dropColumn('n_lit_appoint');
  });
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('n_lit_simple');
    table.dropColumn('n_lit_double');
    table.dropColumn('n_canape_lit');
    table.dropColumn('n_lit_appoint');
  });
};
