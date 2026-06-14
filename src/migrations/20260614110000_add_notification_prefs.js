exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    // Préférences de notifications push par catégorie. Une catégorie est
    // activée par défaut ; désactivée seulement si explicitement `false`.
    // Ex : { "comments": false, "reminders": false }
    table.jsonb('notification_prefs').notNullable().defaultTo('{}');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('notification_prefs');
  });
};
