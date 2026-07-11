/**
 * Marqueur « ignoré de la sync » sur `menage`.
 *
 * Quand un admin « retire » une prestation créée automatiquement (sync iCal),
 * on ne peut pas la hard-delete : la sync la recréerait au pull suivant tant
 * que la réservation existe dans le feed. On la marque donc `sync_ignored=true`
 * (+ statut `annule`) → tombstone que la sync ne ré-active/recrée plus jamais.
 * Elle est garbage-collectée (hard delete) une fois passée ET disparue du feed.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.boolean('sync_ignored').notNullable().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('menage', (table) => {
    table.dropColumn('sync_ignored');
  });
};
