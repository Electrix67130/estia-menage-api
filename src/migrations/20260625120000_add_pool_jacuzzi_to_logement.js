/**
 * Ajoute deux équipements optionnels au logement : piscine et jacuzzi.
 * Même logique que has_basement / has_laundry : un booléen qui, à la création
 * d'un ménage, génère une section de checklist dédiée.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.boolean('has_pool').notNullable().defaultTo(false);
    table.boolean('has_jacuzzi').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('has_pool');
    table.dropColumn('has_jacuzzi');
  });
};
