exports.up = async function (knex) {
  await knex.schema.createTable('menage_check_section', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    // section_type : kitchen | living_room | bedroom | bathroom | wc | exterior | basement | laundry | general
    table.string('section_type', 50).notNullable();
    table.string('section_label', 200).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['menage_id', 'position'], 'idx_section_menage_position');
  });

  await knex.schema.createTable('menage_check_item', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('section_id')
      .notNullable()
      .references('id')
      .inTable('menage_check_section')
      .onDelete('CASCADE');
    table.string('item_label', 300).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('validated_at');
    table.uuid('validated_by').references('id').inTable('user').onDelete('SET NULL');
    table.text('comment');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['section_id', 'position'], 'idx_item_section_position');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('menage_check_item');
  await knex.schema.dropTableIfExists('menage_check_section');
};
