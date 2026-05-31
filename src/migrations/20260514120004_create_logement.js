exports.up = function (knex) {
  return knex.schema.createTable('logement', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table.uuid('created_by').notNullable().references('id').inTable('user');
    table.uuid('proprietaire_user_id').references('id').inTable('user').onDelete('SET NULL');

    table.string('name', 200).notNullable();
    table.string('address', 500);
    table.string('city', 100);
    table.string('postal_code', 10);
    table.decimal('latitude', 10, 7);
    table.decimal('longitude', 10, 7);

    // Parametres pieces (utilises pour generer la checklist)
    table.integer('n_bedrooms').notNullable().defaultTo(0);
    table.integer('n_bathrooms').notNullable().defaultTo(0);
    table.integer('n_wc').notNullable().defaultTo(0);
    table.integer('n_kitchens').notNullable().defaultTo(1);
    table.integer('n_living_rooms').notNullable().defaultTo(1);
    table.integer('n_exterior_spaces').notNullable().defaultTo(0);
    table.boolean('has_basement').notNullable().defaultTo(false);
    table.boolean('has_laundry').notNullable().defaultTo(false);

    table.integer('surface_m2');
    table.text('notes');

    table.timestamp('archived_at');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['organization_id'], 'idx_logement_org');
    table.index(['latitude', 'longitude'], 'idx_logement_coords');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('logement');
};
