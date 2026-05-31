exports.up = function (knex) {
  return knex.schema
    .raw(
      `CREATE TYPE menage_status AS ENUM ('a_venir', 'en_cours', 'termine', 'valide', 'annule')`,
    )
    .then(() =>
      knex.schema.createTable('menage', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table
          .uuid('logement_id')
          .notNullable()
          .references('id')
          .inTable('logement')
          .onDelete('CASCADE');
        table
          .uuid('organization_id')
          .notNullable()
          .references('id')
          .inTable('organization')
          .onDelete('CASCADE');
        table.uuid('created_by').notNullable().references('id').inTable('user');
        table
          .uuid('prestataire_user_id')
          .references('id')
          .inTable('user')
          .onDelete('SET NULL');

        table
          .enu('status', ['a_venir', 'en_cours', 'termine', 'valide', 'annule'], {
            useNative: true,
            existingType: true,
            enumName: 'menage_status',
          })
          .notNullable()
          .defaultTo('a_venir');

        // Dates de planification et d'execution
        table.date('date_prevue').notNullable();
        table.time('horaire_prevu');
        table.integer('duree_estimee_min');
        table.date('date_realisation');
        table.timestamp('arrived_at');
        table.timestamp('departed_at');

        // Prix
        table.decimal('prix_prevu', 10, 2);

        // Validation rapport (par manager / admin)
        table.timestamp('validated_at');
        table.uuid('validated_by').references('id').inTable('user').onDelete('SET NULL');
        table.decimal('validated_price', 10, 2);

        table.text('notes_intervention');

        table.timestamp('archived_at');
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.index(['logement_id', 'date_prevue'], 'idx_menage_logement_date');
        table.index(['prestataire_user_id', 'status'], 'idx_menage_prestataire_status');
        table.index(['organization_id', 'status'], 'idx_menage_org_status');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('menage')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS menage_status'));
};
