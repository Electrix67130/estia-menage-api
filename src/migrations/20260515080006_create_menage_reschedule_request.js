exports.up = async function (knex) {
  await knex.schema.raw(
    `CREATE TYPE reschedule_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled')`,
  );
  await knex.schema.createTable('menage_reschedule_request', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    table
      .uuid('requested_by')
      .notNullable()
      .references('id')
      .inTable('user')
      .onDelete('CASCADE');

    table.date('original_date').notNullable();
    table.date('proposed_date').notNullable();
    table.string('proposed_time', 8); // HH:MM[:SS]
    table.text('reason');

    table
      .enu('status', ['pending', 'approved', 'rejected', 'cancelled'], {
        useNative: true,
        existingType: true,
        enumName: 'reschedule_request_status',
      })
      .notNullable()
      .defaultTo('pending');

    table.uuid('decided_by').references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('decided_at');
    table.text('decision_reason');

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['menage_id'], 'idx_reschedule_menage');
    table.index(['status'], 'idx_reschedule_status');
    table.index(['requested_by'], 'idx_reschedule_requester');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('menage_reschedule_request');
  await knex.schema.raw(`DROP TYPE IF EXISTS reschedule_request_status`);
};
