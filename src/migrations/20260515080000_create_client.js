exports.up = async function (knex) {
  await knex.schema.createTable('client', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table.uuid('created_by').references('id').inTable('user').onDelete('SET NULL');

    // Identité
    table.string('first_name', 100);
    table.string('last_name', 100);
    table.string('company_name', 200);
    table.string('email', 255);
    table.string('phone', 30);

    // Adresse facturation
    table.string('billing_address', 500);
    table.string('postal_code', 10);
    table.string('city', 100);
    table.string('country', 2).defaultTo('FR');

    // Légal (B2B)
    table.string('siret', 14);
    table.string('vat_number', 30);

    table.text('notes');

    table.timestamp('archived_at');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['organization_id'], 'idx_client_org');
    table.index(['siret']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('client');
};
