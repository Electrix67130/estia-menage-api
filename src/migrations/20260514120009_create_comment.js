exports.up = function (knex) {
  return knex.schema.createTable('comment', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    // section_id optional : permet de rattacher un commentaire a une piece specifique
    table
      .uuid('section_id')
      .references('id')
      .inTable('menage_check_section')
      .onDelete('SET NULL');
    table.uuid('author_id').notNullable().references('id').inTable('user');
    table.text('content').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['menage_id', 'created_at'], 'idx_comment_menage_created');
    table.index(['section_id'], 'idx_comment_section');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('comment');
};
