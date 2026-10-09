/**
 * Mentions « @Prénom Nom » dans un commentaire : qui a été mentionné. Le texte
 * du commentaire garde le nom en clair ; cette table sert à notifier et à
 * surligner la mention, même si la personne change de nom ensuite.
 */
exports.up = function (knex) {
  return knex.schema.createTable('comment_mention', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('comment_id').notNullable().references('id').inTable('comment').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['comment_id', 'user_id']);
    table.index('user_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('comment_mention');
};
