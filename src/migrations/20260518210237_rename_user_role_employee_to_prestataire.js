/**
 * Renomme la valeur 'employee' en 'prestataire' dans l'enum user_role.
 * Cet enum est partagé par user.role, organization_member.role et invitation.role,
 * donc la modification se propage automatiquement à toutes les colonnes.
 *
 * Met aussi à jour le DEFAULT des colonnes qui utilisent cet enum (PG ne migre pas
 * les defaults automatiquement quand on renomme une valeur).
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TYPE user_role RENAME VALUE 'employee' TO 'prestataire'`);
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'prestataire'`);
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role SET DEFAULT 'prestataire'`);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role SET DEFAULT 'employee'`);
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'employee'`);
  await knex.raw(`ALTER TYPE user_role RENAME VALUE 'prestataire' TO 'employee'`);
};
