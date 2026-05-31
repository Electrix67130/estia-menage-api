/**
 * Réponse d'un prestataire sur un ménage : "présent" (je peux faire) ou
 * "absent" (je peux pas). Le user doit être logement_member role='prestataire'
 * sur le logement parent. L'admin se sert ensuite des "présents" pour affecter.
 */
exports.up = async function (knex) {
  await knex.raw(`CREATE TYPE menage_response_status AS ENUM ('present', 'absent')`);
  await knex.schema.createTable('menage_response', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('menage_id').notNullable().references('id').inTable('menage').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table
      .enu('status', null, {
        useNative: true,
        existingType: true,
        enumName: 'menage_response_status',
      })
      .notNullable();
    table.timestamp('responded_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['menage_id', 'user_id'], { indexName: 'uniq_menage_response_menage_user' });
    table.index(['menage_id']);
    table.index(['user_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('menage_response');
  await knex.raw('DROP TYPE IF EXISTS menage_response_status');
};
