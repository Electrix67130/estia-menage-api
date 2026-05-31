exports.up = async function (knex) {
  // 1. Create organization table with legal info baked in
  await knex.schema.createTable('organization', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 200).notNullable();
    table.uuid('created_by').references('id').inTable('user');

    // Identification legale
    table.string('siret', 14);
    table.string('legal_form', 50);
    table.string('vat_number', 30);
    table.string('naf_code', 10);

    // Adresse du siege
    table.string('address', 500);
    table.string('postal_code', 10);
    table.string('city', 100);
    table.string('country', 2).defaultTo('FR');

    // Contact
    table.string('phone', 20);
    table.string('billing_email', 255);
    table.string('website', 500);

    // Branding
    table.string('logo_url', 500);

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index('siret');
  });

  // 2. Add organization_id + active_organization_id to user
  await knex.schema.alterTable('user', (table) => {
    table
      .uuid('organization_id')
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table
      .uuid('active_organization_id')
      .references('id')
      .inTable('organization')
      .onDelete('SET NULL');
  });

  // 3. Create organization_member (multi-org membership)
  await knex.schema.createTable('organization_member', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('user')
      .onDelete('CASCADE');
    table
      .enu('role', null, {
        useNative: true,
        existingType: true,
        enumName: 'user_role',
      })
      .notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['organization_id', 'user_id']);
    table.index(['user_id'], 'idx_org_member_user');
    table.index(['organization_id'], 'idx_org_member_org');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('organization_member');
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('active_organization_id');
    table.dropColumn('organization_id');
  });
  await knex.schema.dropTable('organization');
};
