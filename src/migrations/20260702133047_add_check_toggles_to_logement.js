/**
 * Active les prestations check-in / check-out sur un logement.
 * Même logique que has_pool / has_jacuzzi : deux booléens de config. Quand ils
 * sont activés, la sync iCal (et la création manuelle) matérialise des
 * prestations dédiées (prestation_type = 'check_in' / 'check_out') en plus du
 * ménage — cf. migration add_prestation_type_to_menage.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.boolean('enable_check_in').notNullable().defaultTo(false);
    table.boolean('enable_check_out').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('enable_check_in');
    table.dropColumn('enable_check_out');
  });
};
