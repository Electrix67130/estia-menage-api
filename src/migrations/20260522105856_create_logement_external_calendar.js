/**
 * Calendriers iCal externes attachés à un logement (Airbnb, Booking, Vrbo, …).
 * Un worker périodique fetch ces URLs et crée des ménages le jour du check-out
 * (DTEND du VEVENT).
 *
 * Aussi : 2 nouvelles colonnes sur `menage` pour identifier les ménages
 * autoCréés depuis un calendrier — permet d'upsert (update si la booking
 * change, cancel si elle disparaît) sans dupliquer.
 */
exports.up = async function (knex) {
  await knex.raw(
    `CREATE TYPE external_calendar_provider AS ENUM ('airbnb', 'booking', 'vrbo', 'ical')`,
  );

  await knex.schema.createTable('logement_external_calendar', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table
      .enu('provider', null, {
        useNative: true,
        existingType: true,
        enumName: 'external_calendar_provider',
      })
      .notNullable()
      .defaultTo('ical');
    /** Libellé affiché à l'admin (ex: "Airbnb appartement A"). Optionnel. */
    table.string('label', 200);
    /** URL publique de l'iCal (text/calendar). */
    table.string('url', 1000).notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('last_synced_at');
    /** Dernière erreur de sync (texte), null = OK. */
    table.text('last_error');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['logement_id']);
  });

  await knex.schema.alterTable('menage', (table) => {
    table.string('external_source', 50);
    table.string('external_event_uid', 255);
    // Un VEVENT (UID donné) ne peut générer qu'un seul ménage par source.
    // (logement_id implicite via menage.logement_id, mais pas dans la contrainte
    // pour permettre de retrouver le ménage uniquement par (source, uid).)
    table.unique(['external_source', 'external_event_uid'], {
      indexName: 'uniq_menage_external_event',
    });
    table.index(['external_source']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('menage', (table) => {
    table.dropUnique(['external_source', 'external_event_uid'], 'uniq_menage_external_event');
    table.dropIndex(['external_source']);
    table.dropColumn('external_event_uid');
    table.dropColumn('external_source');
  });
  await knex.schema.dropTable('logement_external_calendar');
  await knex.raw('DROP TYPE IF EXISTS external_calendar_provider');
};
