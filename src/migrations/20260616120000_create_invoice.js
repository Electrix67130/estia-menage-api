exports.up = async function (knex) {
  await knex.schema.createTable('invoice', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organization')
      .onDelete('CASCADE');
    table.uuid('client_id').references('id').inTable('client').onDelete('SET NULL');
    // 'invoice' (facture) ou 'quote' (devis)
    table.string('type', 10).notNullable().defaultTo('invoice');
    // Numéro séquentiel légal, attribué à la finalisation (NULL tant que brouillon).
    table.string('number', 30).nullable();
    // draft | sent | paid | cancelled (facture) ; draft | sent | accepted | refused (devis)
    table.string('status', 20).notNullable().defaultTo('draft');
    table.date('issue_date').nullable();
    table.date('due_date').nullable();
    table.date('period_start').nullable();
    table.date('period_end').nullable();
    table.string('currency', 3).notNullable().defaultTo('EUR');
    table.decimal('total_ht', 10, 2).notNullable().defaultTo(0);
    table.decimal('total_tva', 10, 2).notNullable().defaultTo(0);
    table.decimal('total_ttc', 10, 2).notNullable().defaultTo(0);
    table.text('notes').nullable();
    table.uuid('created_by').references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['organization_id'], 'idx_invoice_org');
    table.index(['client_id'], 'idx_invoice_client');
  });

  await knex.schema.createTable('invoice_line', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('invoice_id')
      .notNullable()
      .references('id')
      .inTable('invoice')
      .onDelete('CASCADE');
    // Ménage facturé (NULL = ligne manuelle / ménage supprimé).
    table.uuid('menage_id').references('id').inTable('menage').onDelete('SET NULL');
    table.text('label').notNullable();
    table.decimal('quantity', 10, 2).notNullable().defaultTo(1);
    table.decimal('unit_price_ht', 10, 2).notNullable().defaultTo(0);
    table.decimal('vat_rate', 5, 2).notNullable().defaultTo(0);
    table.decimal('line_ht', 10, 2).notNullable().defaultTo(0);
    table.decimal('line_tva', 10, 2).notNullable().defaultTo(0);
    table.decimal('line_ttc', 10, 2).notNullable().defaultTo(0);
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['invoice_id'], 'idx_invoice_line_invoice');
    table.index(['menage_id'], 'idx_invoice_line_menage');
  });

  // Suivi de la paie prestataire (ce que l'org paie au presta pour un ménage).
  await knex.schema.alterTable('menage', (table) => {
    table.timestamp('provider_paid_at').nullable();
    table.uuid('provider_paid_by').references('id').inTable('user').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('provider_paid_at');
    table.dropColumn('provider_paid_by');
  });
  await knex.schema.dropTableIfExists('invoice_line');
  await knex.schema.dropTableIfExists('invoice');
};
