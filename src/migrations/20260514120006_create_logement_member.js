exports.up = function (knex) {
  return knex.schema
    .raw(
      `CREATE TYPE logement_member_role AS ENUM ('manager', 'prestataire', 'client_proprietaire')`,
    )
    .then(() =>
      knex.schema.createTable('logement_member', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table
          .uuid('logement_id')
          .notNullable()
          .references('id')
          .inTable('logement')
          .onDelete('CASCADE');
        table
          .uuid('user_id')
          .notNullable()
          .references('id')
          .inTable('user')
          .onDelete('CASCADE');
        table
          .enu('role', ['manager', 'prestataire', 'client_proprietaire'], {
            useNative: true,
            existingType: true,
            enumName: 'logement_member_role',
          })
          .notNullable();

        // Permissions granulaires (defauts depends du role, geres cote service)
        table.boolean('can_view_comments').notNullable().defaultTo(true);
        table.boolean('can_view_photos').notNullable().defaultTo(true);
        table.boolean('can_view_checklist').notNullable().defaultTo(true);
        table.boolean('can_view_team').notNullable().defaultTo(false);
        table.boolean('can_edit').notNullable().defaultTo(false);

        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.unique(['logement_id', 'user_id']);
        table.index(['logement_id'], 'idx_logement_member_logement');
        table.index(['user_id'], 'idx_logement_member_user');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('logement_member')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS logement_member_role'));
};
