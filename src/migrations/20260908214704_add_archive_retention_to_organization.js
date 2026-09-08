/**
 * `organization.archive_retention_years` : durée de conservation des archives.
 *
 * La colonne était déclarée depuis le début dans le schéma Zod
 * (`updateOrganizationSchema`) et dans `OrganizationRow`, mais **aucune
 * migration ne l'avait jamais créée**. Conséquence : la console super admin
 * plantait en 500 (`column organization.archive_retention_years does not
 * exist`), et un `PATCH /organizations/:id` la transmettant aurait fait pareil.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('organization', 'archive_retention_years'))) {
    await knex.schema.alterTable('organization', (table) => {
      table.integer('archive_retention_years').notNullable().defaultTo(5);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('organization', 'archive_retention_years')) {
    await knex.schema.alterTable('organization', (table) => {
      table.dropColumn('archive_retention_years');
    });
  }
};
