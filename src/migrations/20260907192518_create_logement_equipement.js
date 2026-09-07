/**
 * Inventaire des équipements d'un logement (appareil à raclette, plaque de
 * cuisson, lave-vaisselle…). Référentiel du bien, saisi par l'admin et consulté
 * par les prestataires. Rattachement optionnel à une pièce.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('logement_equipement', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table
      .uuid('logement_room_id')
      .nullable()
      .references('id')
      .inTable('logement_room')
      .onDelete('SET NULL');
    table.string('label', 200).notNullable();
    table.string('category', 50); // cuisine, electromenager, confort, exterieur, loisirs, bebe, securite, autre
    table.integer('quantity').notNullable().defaultTo(1);
    table.text('notes');
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['logement_id'], 'idx_logement_equipement_logement');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('logement_equipement');
};
