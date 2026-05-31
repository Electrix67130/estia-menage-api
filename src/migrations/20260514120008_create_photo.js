exports.up = function (knex) {
  return knex.schema.createTable('photo', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    table
      .uuid('section_id')
      .references('id')
      .inTable('menage_check_section')
      .onDelete('SET NULL');
    table.uuid('uploaded_by').notNullable().references('id').inTable('user');
    table.string('url', 1000).notNullable();
    table.string('thumbnail_url', 1000);
    table.string('caption', 500);
    table.decimal('latitude', 10, 7);
    table.decimal('longitude', 10, 7);
    table.timestamp('taken_at').notNullable();
    table.integer('file_size');
    table.string('mime_type', 100);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['menage_id', 'taken_at'], 'idx_photo_menage_taken');
    table.index(['section_id'], 'idx_photo_section');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('photo');
};
