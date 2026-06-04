/**
 * Suivi des consultations par utilisateur, pour les badges « non-lus » du
 * dashboard. Une ligne = la dernière fois qu'un user a ouvert un onglet donné
 * d'un ménage (commentaires, photos, etc.). Les non-lus = items créés après
 * `last_viewed_at`. Seuls les onglets adossés à une entité existante sont
 * calculés (commentaires, commentaires d'étapes, photos) ; les autres
 * (documents, urgences) renvoient 0 tant que ces entités n'existent pas.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('menage_view', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('user')
      .onDelete('CASCADE');
    table
      .uuid('menage_id')
      .notNullable()
      .references('id')
      .inTable('menage')
      .onDelete('CASCADE');
    table.string('tab', 40).notNullable();
    table.timestamp('last_viewed_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['user_id', 'menage_id', 'tab'], 'uq_menage_view_user_menage_tab');
    table.index(['user_id', 'menage_id'], 'idx_menage_view_user_menage');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('menage_view');
};
