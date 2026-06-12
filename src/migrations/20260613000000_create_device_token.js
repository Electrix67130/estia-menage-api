exports.up = function (knex) {
  return knex.schema.createTable('device_token', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('user')
      .onDelete('CASCADE');
    // Token push Expo (ExponentPushToken[...]). Unique : un meme appareil ne
    // doit pas etre enregistre deux fois.
    table.text('token').notNullable().unique();
    table.string('platform', 16).nullable(); // 'ios' | 'android'

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['user_id'], 'idx_device_token_user');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('device_token');
};
