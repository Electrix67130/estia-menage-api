/**
 * Ajoute une FK nullable `client.user_id` → `user.id`.
 *
 * Pourquoi nullable : un `client` (entité de facturation) peut exister sans
 * compte utilisateur associé (ex: client one-shot pour une facture, pas de
 * besoin de login).
 *
 * Pourquoi `SET NULL` : si on supprime le compte utilisateur, on garde la
 * ligne client pour l'historique de facturation. La perte du lien est
 * acceptable, la perte de la facturation non.
 *
 * Backfill : match par (organization_id, email) avec les users role='client'.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('client', (table) => {
    table
      .uuid('user_id')
      .references('id')
      .inTable('user')
      .onDelete('SET NULL')
      .nullable();
    table.index(['user_id'], 'idx_client_user_id');
    // Garantit qu'un user n'a qu'une seule ligne client par org (évite les doublons
    // si l'auto-création tourne 2x suite à un bug ou une race).
    table.unique(['organization_id', 'user_id'], { indexName: 'uniq_client_org_user' });
  });

  // Backfill : pour chaque user role='client' avec un email, on associe la ligne
  // client correspondante (match par email + org). Si plusieurs lignes existent
  // pour le même email, on prend la première (created_at asc) — cas rare et déjà
  // ambigu.
  await knex.raw(`
    UPDATE "client" c
    SET user_id = match.user_id
    FROM (
      SELECT DISTINCT ON (om.organization_id, u.email)
        u.id AS user_id,
        u.email,
        om.organization_id
      FROM "user" u
      JOIN organization_member om ON om.user_id = u.id
      WHERE om.role = 'client'
        AND u.email IS NOT NULL
      ORDER BY om.organization_id, u.email, u.created_at ASC
    ) AS match
    WHERE c.organization_id = match.organization_id
      AND c.email = match.email
      AND c.user_id IS NULL
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('client', (table) => {
    table.dropUnique(['organization_id', 'user_id'], 'uniq_client_org_user');
    table.dropIndex(['user_id'], 'idx_client_user_id');
    table.dropColumn('user_id');
  });
};
