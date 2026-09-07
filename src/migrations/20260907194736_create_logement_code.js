/**
 * Codes d'accès d'un logement : plusieurs codes, chacun avec son libellé
 * personnalisé (« Boîte à clés », « Portail », « Alarme », « Wi-Fi »…).
 *
 * Remplace le champ unique `logement.key_safe_code`, qui est conservé en
 * MIROIR (première ligne de la liste) : la jointure `logement_key_safe_code`
 * du détail ménage et les anciens clients continuent de fonctionner.
 * Les codes existants sont repris en ligne « Boîte à clés ».
 */
exports.up = async function (knex) {
  await knex.schema.createTable('logement_code', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('logement_id')
      .notNullable()
      .references('id')
      .inTable('logement')
      .onDelete('CASCADE');
    table.string('label', 100).notNullable(); // libellé personnalisé
    table.string('code', 100).notNullable();
    table.text('notes');
    table.integer('position').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['logement_id'], 'idx_logement_code_logement');
  });

  // Backfill : chaque code boîte à clef existant devient la première ligne.
  const logements = await knex('logement')
    .whereNotNull('key_safe_code')
    .whereRaw("btrim(key_safe_code) <> ''")
    .select('id', 'key_safe_code');
  if (logements.length > 0) {
    await knex('logement_code').insert(
      logements.map((l) => ({
        logement_id: l.id,
        label: 'Boîte à clés',
        code: l.key_safe_code.trim(),
        position: 0,
      })),
    );
  }
};

exports.down = function (knex) {
  return knex.schema.dropTable('logement_code');
};
