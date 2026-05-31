exports.up = async function (knex) {
  await knex.schema.createTable('logement_room', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table.string('name', 200).notNullable();
    table.string('kind', 50); // chambre, salle_de_bain, cuisine, salon, exterieur, autre
    table.integer('position').notNullable().defaultTo(0);
    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['logement_id'], 'idx_logement_room_logement');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('logement_room');
};
