/**
 * Consommables par logement + relevés au pointage de fin.
 *
 * - `logement_consommable` : liste configurée par l'admin pour un logement
 *   (PQ, savon, capsules café…), avec un seuil d'alerte. Soft-delete via
 *   `archived_at` pour préserver l'historique des relevés.
 * - `menage_consommable_releve` : à chaque pointage de fin, le prestataire
 *   saisit la quantité restante de chaque consommable → un relevé daté par
 *   ménage (historique). Le "stock courant" d'un logement = le relevé le plus
 *   récent de chaque consommable ; alerte si qté <= seuil.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('logement_consommable', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table.string('label', 200).notNullable();
    table.string('unit', 30).nullable(); // ex : rouleaux, capsules, L
    table.integer('seuil_alerte').notNullable().defaultTo(1); // qté <= seuil → à racheter
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('archived_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['logement_id'], 'idx_logement_consommable_logement');
  });

  await knex.schema.createTable('menage_consommable_releve', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    table
      .uuid('logement_consommable_id')
      .notNullable()
      .references('id')
      .inTable('logement_consommable')
      .onDelete('CASCADE');
    table.integer('qty').notNullable(); // quantité restante (0 = rupture)
    table.uuid('recorded_by').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('recorded_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['menage_id', 'logement_consommable_id'], 'uq_menage_consommable_releve');
    table.index(['logement_consommable_id'], 'idx_releve_consommable');
    table.index(['menage_id'], 'idx_releve_menage');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('menage_consommable_releve');
  await knex.schema.dropTableIfExists('logement_consommable');
};
