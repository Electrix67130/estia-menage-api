/**
 * Suppression du rôle 'client' (compte/login).
 *
 * Désormais un "client" est une simple fiche-annuaire (table `client`), pas
 * un utilisateur authentifié. Ce qui implique :
 *  1. Supprimer les invitations role='client' (orphelines).
 *  2. Supprimer les organization_member role='client' (perte d'accès).
 *  3. Re-router les users role='client' vers role='prestataire' (valeur
 *     valide ; comme ils n'ont plus de membership, plus d'accès effectif).
 *  4. Recréer l'enum user_role sans 'client'.
 *  5. Drop la colonne `client.user_id` (plus de lien user ↔ fiche).
 *
 * Les fiches `client` (table) sont conservées telles quelles ; elles ont déjà
 * été backfillées depuis les users role='client' par 20260518212704.
 */

exports.up = async function (knex) {
  await knex('invitation').where('role', 'client').delete();
  await knex('organization_member').where('role', 'client').delete();
  await knex.raw(`UPDATE "user" SET role='prestataire' WHERE role='client'`);

  // Recréation de l'enum user_role sans 'client' (Postgres ne permet pas le
  // DROP VALUE direct → rename + recreate + alter columns). On retire
  // temporairement le DEFAULT sur user.role (PG ne sait pas le cast).
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role DROP DEFAULT`);
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role DROP DEFAULT`);
  await knex.raw(`ALTER TYPE user_role RENAME TO user_role_old`);
  await knex.raw(`CREATE TYPE user_role AS ENUM ('admin','prestataire')`);
  await knex.raw(
    `ALTER TABLE "user" ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(
    `ALTER TABLE organization_member ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(
    `ALTER TABLE invitation ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'prestataire'`);
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role SET DEFAULT 'prestataire'`);
  await knex.raw(`DROP TYPE user_role_old`);

  await knex.schema.alterTable('client', (table) => {
    table.dropUnique(['organization_id', 'user_id'], 'uniq_client_org_user');
    table.dropIndex(['user_id'], 'idx_client_user_id');
    table.dropColumn('user_id');
  });
};

exports.down = async function (knex) {
  // Restauration best-effort : ré-ajoute 'client' à l'enum + colonne user_id.
  // Les données supprimées (memberships, invitations) ne sont pas restaurées.
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role DROP DEFAULT`);
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role DROP DEFAULT`);
  await knex.raw(`ALTER TYPE user_role RENAME TO user_role_old`);
  await knex.raw(`CREATE TYPE user_role AS ENUM ('admin','prestataire','client')`);
  await knex.raw(
    `ALTER TABLE "user" ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(
    `ALTER TABLE organization_member ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(
    `ALTER TABLE invitation ALTER COLUMN role TYPE user_role USING role::text::user_role`,
  );
  await knex.raw(`ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'prestataire'`);
  await knex.raw(`ALTER TABLE invitation ALTER COLUMN role SET DEFAULT 'prestataire'`);
  await knex.raw(`DROP TYPE user_role_old`);

  await knex.schema.alterTable('client', (table) => {
    table.uuid('user_id').nullable();
    table.foreign('user_id').references('user.id').onDelete('SET NULL');
    table.index('user_id', 'idx_client_user_id');
    table.unique(['organization_id', 'user_id'], 'uniq_client_org_user');
  });
};
