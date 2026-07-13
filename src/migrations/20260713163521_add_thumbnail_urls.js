/**
 * Miniatures (thumbnail_url) pour l'avatar utilisateur et la couverture de
 * logement. Générées à l'upload (~400px) et affichées dans les listes/cards à
 * la place de l'original (jusqu'à 2000px) → chargement bien plus rapide.
 *
 * `photo.thumbnail_url` existe déjà ; on ajoute seulement les deux colonnes
 * manquantes. Nullable (les images déjà uploadées n'ont pas de miniature → le
 * front retombe sur l'URL originale).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.string('avatar_thumbnail_url', 500).nullable();
  });
  await knex.schema.alterTable('logement', (table) => {
    table.string('cover_photo_thumbnail_url', 500).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('avatar_thumbnail_url');
  });
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('cover_photo_thumbnail_url');
  });
};
