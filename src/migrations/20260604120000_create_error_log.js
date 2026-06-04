/**
 * Journal des erreurs 500 (« Sentry maison »). Alimenté en fire-and-forget par
 * le plugin error-handler à chaque erreur inconnue. La table manquait, ce qui
 * faisait échouer silencieusement l'insert (« relation "error_log" does not exist »).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('error_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('level', 20).notNullable().defaultTo('error');
    table.text('message').notNullable();
    table.text('stack').nullable();
    table.text('route').nullable();
    table.string('method', 10).nullable();
    table
      .uuid('user_id')
      .nullable()
      .references('id')
      .inTable('user')
      .onDelete('SET NULL');
    table.integer('status_code').nullable();
    table.string('request_id', 100).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['created_at'], 'idx_error_log_created_at');
    table.index(['user_id'], 'idx_error_log_user');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('error_log');
};
