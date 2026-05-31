exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE user_role AS ENUM ('admin', 'employee', 'client')`)
    .then(() =>
      knex.schema.createTable('user', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.string('email', 255).notNullable().unique();
        table.string('password_hash', 255).notNullable();
        table.string('first_name', 100).notNullable();
        table.string('last_name', 100).notNullable();
        table.string('phone', 20);
        table.string('avatar_url', 500);
        table
          .enu('role', ['admin', 'employee', 'client'], {
            useNative: true,
            existingType: true,
            enumName: 'user_role',
          })
          .notNullable()
          .defaultTo('employee');
        table.string('company_name', 200);
        table.boolean('is_active').notNullable().defaultTo(true);
        // active_organization_id and organization_id added in create_organization migration (FK loop)
        // current_session_id used pour single-session enforcement
        table.string('current_session_id', 64);
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
      }),
    );
};

exports.down = function (knex) {
  return knex.schema.dropTable('user').then(() => knex.schema.raw('DROP TYPE IF EXISTS user_role'));
};
