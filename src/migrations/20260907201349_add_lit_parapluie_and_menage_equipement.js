/**
 * 1. `n_lit_parapluie` : 5e type de couchage (lit parapluie / lit bébé), sur
 *    `logement` (valeur par défaut du bien) et `menage` (valeur effective),
 *    comme les 4 autres compteurs.
 *
 * 2. `menage_equipement` : équipements du logement que l'admin demande de
 *    **préparer** pour une prestation donnée (chaise haute, baignoire bébé…).
 *    Le prestataire les coche une fois sortis/installés.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.integer('n_lit_parapluie').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('menage', (table) => {
    table.integer('n_lit_parapluie').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('menage_equipement', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    table
      .uuid('logement_equipement_id')
      .notNullable()
      .references('id')
      .inTable('logement_equipement')
      .onDelete('CASCADE');
    table.integer('quantity').notNullable().defaultTo(1);
    table.text('notes');
    // Coché par le prestataire quand l'équipement est préparé.
    table.timestamp('done_at').nullable();
    table.uuid('done_by').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['menage_id', 'logement_equipement_id'], {
      indexName: 'uniq_menage_equipement',
    });
    table.index(['menage_id'], 'idx_menage_equipement_menage');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('menage_equipement');
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('n_lit_parapluie');
  });
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('n_lit_parapluie');
  });
};
