/**
 * Signalement de contenu (App Store 1.2 — contenu généré par les utilisateurs) :
 * un `feedback` de type `report` vise un commentaire ou une photo précis.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('feedback', (table) => {
    table.string('target_type', 20).nullable();
    table.uuid('target_id').nullable();
    table.index(['target_type', 'target_id'], 'idx_feedback_target');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('feedback', (table) => {
    table.dropIndex(['target_type', 'target_id'], 'idx_feedback_target');
    table.dropColumn('target_type');
    table.dropColumn('target_id');
  });
};
