/**
 * Options proposées au client sur un logement (pack romantique, pack
 * anniversaire, panier gourmand…), configurées par l'admin dans la préparation
 * du logement.
 *
 * `menage_option` = l'option retenue par le client pour une prestation donnée :
 * l'admin la coche, le prestataire la voit et l'installe. Le prestataire est en
 * LECTURE SEULE (pas de champ « fait » : rien à cocher côté terrain).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('logement_option', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table.string('label', 150).notNullable();
    table.text('description'); // ce que le presta doit installer
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['logement_id'], 'idx_logement_option_logement');
  });

  await knex.schema.createTable('menage_option', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('menage_id').notNullable().references('id').inTable('menage').onDelete('CASCADE');
    table
      .uuid('logement_option_id')
      .notNullable()
      .references('id')
      .inTable('logement_option')
      .onDelete('CASCADE');
    table.text('notes'); // précision pour cette prestation (ex : « prénom sur le gâteau »)
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['menage_id', 'logement_option_id'], { indexName: 'uniq_menage_option' });
    table.index(['menage_id'], 'idx_menage_option_menage');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('menage_option');
  await knex.schema.dropTable('logement_option');
};
