/**
 * Répondre à un message précis, et y réagir d'un emoji (repris de Buildr).
 *
 * `comment.reply_to_id` désigne le message cité. S'il est supprimé, la réponse
 * reste et perd simplement sa citation (SET NULL) : on ne supprime pas la
 * parole de quelqu'un parce qu'un autre a retiré la sienne.
 *
 * `comment_reaction` : une ligne par personne, par message et par emoji.
 * L'unicité fait de la réaction un interrupteur : réagir deux fois du même
 * emoji la retire.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('comment', (table) => {
    table.uuid('reply_to_id').nullable().references('id').inTable('comment').onDelete('SET NULL');
    table.index(['reply_to_id'], 'idx_comment_reply_to');
  });
  await knex.schema.createTable('comment_reaction', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('comment_id').notNullable().references('id').inTable('comment').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('emoji', 16).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['comment_id', 'user_id', 'emoji'], 'uq_comment_reaction');
    table.index(['comment_id'], 'idx_comment_reaction_comment');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('comment_reaction');
  await knex.schema.alterTable('comment', (table) => {
    table.dropIndex(['reply_to_id'], 'idx_comment_reply_to');
    table.dropColumn('reply_to_id');
  });
};
