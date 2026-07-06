/**
 * Icône (emoji) optionnelle par section de checklist :
 *  - `logement_check_template_section.icon` : choisie dans l'éditeur de template.
 *  - `menage_check_section.icon` : copiée depuis le template à la génération.
 * `null` = aucune icône (choix explicite « pas d'icône »).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('logement_check_template_section', (table) => {
    table.string('icon', 16).nullable();
  });
  await knex.schema.alterTable('menage_check_section', (table) => {
    table.string('icon', 16).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('logement_check_template_section', (table) => {
    table.dropColumn('icon');
  });
  await knex.schema.alterTable('menage_check_section', (table) => {
    table.dropColumn('icon');
  });
};
