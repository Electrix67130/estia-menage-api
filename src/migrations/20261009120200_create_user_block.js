/**
 * Blocage entre utilisateurs (repris de Buildr) : les messages et photos de la
 * personne bloquée disparaissent pour celle qui bloque, et pour elle seule. La
 * personne bloquée n'en est pas informée et continue de travailler.
 *
 * Pendant du signalement (exigé par l'App Store 1.2) : le signalement remonte
 * à l'admin, le blocage protège tout de suite celui qui ne veut plus lire
 * quelqu'un.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('user_block', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('blocker_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('blocked_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['blocker_id', 'blocked_id'], 'uq_user_block');
    table.index(['blocker_id'], 'idx_user_block_blocker');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('user_block');
};
