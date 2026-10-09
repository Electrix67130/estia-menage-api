/**
 * Réglages des notifications (inspirés de Buildr), en trois niveaux :
 * 1. `user.push_enabled` coupe tout — le seul recours manquait : on ne pouvait
 *    couper qu'une catégorie à la fois ;
 * 2. `user.notification_prefs` (existant) coupe une catégorie partout ;
 * 3. `logement_notification_level` règle un logement : tout (pas de ligne),
 *    l'important seulement, ou rien. Une conciergerie a beaucoup de logements :
 *    sans ce réglage, l'admin reçoit tout de chacun.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.boolean('push_enabled').notNullable().defaultTo(true);
  });
  await knex.schema.createTable('logement_notification_level', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('logement_id').notNullable().references('id').inTable('logement').onDelete('CASCADE');
    // 'important' : ce qui me concerne personnellement. 'none' : rien du tout.
    table.string('level', 16).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['user_id', 'logement_id'], 'uq_logement_notification_level');
    table.index(['logement_id'], 'idx_logement_notification_level_logement');
  });
  await knex.raw(
    "ALTER TABLE logement_notification_level ADD CONSTRAINT chk_logement_notification_level CHECK (level IN ('important', 'none'))",
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTable('logement_notification_level');
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('push_enabled');
  });
};
