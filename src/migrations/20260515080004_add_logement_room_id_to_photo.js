exports.up = async function (knex) {
  await knex.schema.alterTable('photo', (table) => {
    // Une photo peut désormais être attachée à un logement ou à une pièce
    // sans qu'elle soit liée à un ménage particulier (photos de la fiche logement).
    table.uuid('logement_id').references('id').inTable('logement').onDelete('CASCADE');
    table
      .uuid('logement_room_id')
      .references('id')
      .inTable('logement_room')
      .onDelete('SET NULL');

    table.index(['logement_id'], 'idx_photo_logement');
    table.index(['logement_room_id'], 'idx_photo_room');
  });

  // menage_id devient nullable (le constraint NOT NULL d'origine est levé)
  await knex.raw('ALTER TABLE photo ALTER COLUMN menage_id DROP NOT NULL');

  // Contrainte : au moins un parent (menage OU logement)
  await knex.raw(`
    ALTER TABLE photo ADD CONSTRAINT photo_parent_check
      CHECK (menage_id IS NOT NULL OR logement_id IS NOT NULL)
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE photo DROP CONSTRAINT IF EXISTS photo_parent_check');
  await knex.raw('ALTER TABLE photo ALTER COLUMN menage_id SET NOT NULL');
  await knex.schema.alterTable('photo', (table) => {
    table.dropIndex(['logement_id'], 'idx_photo_logement');
    table.dropIndex(['logement_room_id'], 'idx_photo_room');
    table.dropColumn('logement_room_id');
    table.dropColumn('logement_id');
  });
};
