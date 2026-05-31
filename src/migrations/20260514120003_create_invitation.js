exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired')`)
    .then(() =>
      knex.schema.createTable('invitation', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.string('email', 255).notNullable();
        table.uuid('invited_by').notNullable().references('id').inTable('user');
        table
          .uuid('organization_id')
          .notNullable()
          .references('id')
          .inTable('organization')
          .onDelete('CASCADE');
        table
          .enu('role', null, {
            useNative: true,
            existingType: true,
            enumName: 'user_role',
          })
          .notNullable()
          .defaultTo('employee');
        table.string('token', 255).notNullable().unique();
        table
          .enu('status', ['pending', 'accepted', 'expired'], {
            useNative: true,
            existingType: true,
            enumName: 'invitation_status',
          })
          .notNullable()
          .defaultTo('pending');
        table.timestamp('expires_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('invitation')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS invitation_status'));
};
