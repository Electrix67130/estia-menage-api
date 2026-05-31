exports.up = async function (knex) {
  // Section de checklist personnalisée par logement
  await knex.schema.createTable('logement_check_template_section', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table
      .uuid('logement_room_id')
      .references('id')
      .inTable('logement_room')
      .onDelete('SET NULL');
    table.string('label', 200).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['logement_id'], 'idx_check_template_section_logement');
  });

  // Item dans une section
  await knex.schema.createTable('logement_check_template_item', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('section_id')
      .notNullable()
      .references('id')
      .inTable('logement_check_template_section')
      .onDelete('CASCADE');
    table.string('label', 300).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.boolean('required').notNullable().defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['section_id'], 'idx_check_template_item_section');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('logement_check_template_item');
  await knex.schema.dropTableIfExists('logement_check_template_section');
};
