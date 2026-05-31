/**
 * Ajout sur `logement` :
 * - `key_safe_code` : code de boîte à clef (saisi par l'admin, visible
 *   aux membres du logement pour qu'ils puissent entrer faire le ménage).
 * - `cover_photo_url` : photo de profil/cover du logement. Stockée comme URL
 *   directe (uploadée via le flow photo existant, puis on PATCH le logement
 *   avec l'URL retournée).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.string('key_safe_code', 50).nullable();
    table.string('cover_photo_url', 500).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement', (table) => {
    table.dropColumn('cover_photo_url');
    table.dropColumn('key_safe_code');
  });
};
