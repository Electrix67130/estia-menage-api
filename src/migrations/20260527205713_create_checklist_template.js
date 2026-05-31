/**
 * Modèles de checklist réutilisables au niveau de l'organisation. À la création
 * d'un logement, l'admin peut appliquer un modèle : ses sections + items sont
 * copiés dans la checklist du logement (`logement_check_template_*`).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('checklist_template', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table.string('name', 200).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['organization_id'], 'idx_checklist_template_org');
  });

  await knex.schema.createTable('checklist_template_section', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('template_id')
      .notNullable()
      .references('id')
      .inTable('checklist_template')
      .onDelete('CASCADE');
    table.string('label', 200).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['template_id'], 'idx_checklist_template_section_template');
  });

  await knex.schema.createTable('checklist_template_item', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('section_id')
      .notNullable()
      .references('id')
      .inTable('checklist_template_section')
      .onDelete('CASCADE');
    table.string('label', 300).notNullable();
    table.integer('position').notNullable().defaultTo(0);
    table.boolean('required').notNullable().defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['section_id'], 'idx_checklist_template_item_section');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('checklist_template_item');
  await knex.schema.dropTableIfExists('checklist_template_section');
  await knex.schema.dropTableIfExists('checklist_template');
};
