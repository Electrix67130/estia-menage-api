/**
 * Table de jointure menage ↔ user pour permettre d'affecter PLUSIEURS
 * prestataires à un même ménage.
 *
 * Stratégie de transition (soft) : on garde `menage.prestataire_user_id`
 * comme "prestataire principal" (= la valeur la plus ancienne dans la
 * jointure, ou null si aucune affectation). La colonne reste utile pour :
 *  - rétro-compat des queries existantes (filter, sort, etc.)
 *  - savoir rapidement s'il y a un référent (sans JOIN)
 *
 * La jointure stocke TOUS les prestataires affectés ; le service maintient
 * la cohérence `prestataire_user_id ↔ menage_prestataire` via l'app.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('menage_prestataire', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('menage_id').notNullable().references('id').inTable('menage').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['menage_id', 'user_id'], { indexName: 'uniq_menage_prestataire' });
    table.index(['menage_id']);
    table.index(['user_id']);
  });

  // Backfill : pour chaque ménage avec un prestataire_user_id, on insère la
  // row correspondante. Idempotent (UNIQUE empêche les doublons si re-run).
  await knex.raw(`
    INSERT INTO menage_prestataire (menage_id, user_id)
    SELECT id, prestataire_user_id FROM menage WHERE prestataire_user_id IS NOT NULL
    ON CONFLICT (menage_id, user_id) DO NOTHING
  `);
};

exports.down = function (knex) {
  return knex.schema.dropTable('menage_prestataire');
};
