/**
 * La contrainte d'unicité iCal `uniq_menage_external_event (external_source,
 * external_event_uid)` empêchait une même réservation de matérialiser plusieurs
 * prestations (ménage + check-in + check-out) : le 2e insert du même UID
 * violait la contrainte. On la remplace par une clé incluant `prestation_type`
 * pour autoriser une ligne par type et par événement.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropUnique(['external_source', 'external_event_uid'], 'uniq_menage_external_event');
    table.unique(['external_source', 'external_event_uid', 'prestation_type'], {
      indexName: 'uniq_menage_external_event',
    });
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropUnique(
      ['external_source', 'external_event_uid', 'prestation_type'],
      'uniq_menage_external_event',
    );
    table.unique(['external_source', 'external_event_uid'], {
      indexName: 'uniq_menage_external_event',
    });
  });
};
