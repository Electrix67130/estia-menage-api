/**
 * Rattache un ménage auto-créé au calendrier externe précis qui l'a généré.
 * Sans ça, deux calendriers du même provider sur un logement partagent le même
 * `external_source` (`cal_airbnb`) et la sync de l'un annule les ménages de
 * l'autre. La colonne isole chaque calendrier.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table
      .uuid('external_calendar_id')
      .nullable()
      .references('id')
      .inTable('logement_external_calendar')
      .onDelete('SET NULL');
    table.index(['external_calendar_id'], 'idx_menage_external_calendar');
  });

  // Backfill best-effort : si un logement n'a qu'UN seul calendrier du provider
  // correspondant à `external_source`, on rattache ses ménages auto à ce
  // calendrier. Les cas ambigus (plusieurs calendriers même provider) restent
  // null et seront re-rattachés au prochain sync.
  await knex.raw(`
    UPDATE menage m
    SET external_calendar_id = c.id
    FROM logement_external_calendar c
    WHERE m.external_source = ('cal_' || c.provider)
      AND m.logement_id = c.logement_id
      AND m.external_calendar_id IS NULL
      AND (
        SELECT COUNT(*) FROM logement_external_calendar c2
        WHERE c2.logement_id = m.logement_id AND ('cal_' || c2.provider) = m.external_source
      ) = 1
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropColumn('external_calendar_id');
  });
};
