exports.up = function (knex) {
  return knex.schema.alterTable('logement', (table) => {
    table.uuid('client_id').references('id').inTable('client').onDelete('SET NULL');
    table.index(['client_id'], 'idx_logement_client');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('logement', (table) => {
    table.dropIndex(['client_id'], 'idx_logement_client');
    table.dropColumn('client_id');
  });
};
