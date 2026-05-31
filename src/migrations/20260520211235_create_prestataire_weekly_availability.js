/**
 * Disponibilités hebdomadaires récurrentes du prestataire.
 * 1 ligne par couple (user, organization) : un user peut être prestataire dans
 * plusieurs orgs et avoir des dispos différentes par org.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('prestataire_weekly_availability', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table.boolean('monday').notNullable().defaultTo(false);
    table.boolean('tuesday').notNullable().defaultTo(false);
    table.boolean('wednesday').notNullable().defaultTo(false);
    table.boolean('thursday').notNullable().defaultTo(false);
    table.boolean('friday').notNullable().defaultTo(false);
    table.boolean('saturday').notNullable().defaultTo(false);
    table.boolean('sunday').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['user_id', 'organization_id'], {
      indexName: 'uniq_weekly_availability_user_org',
    });
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('prestataire_weekly_availability');
};
