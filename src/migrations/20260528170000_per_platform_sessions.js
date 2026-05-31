/**
 * Sessions par plateforme.
 *
 * Avant : 1 seule session active par user (current_session_id) → se connecter
 * sur le dashboard kickait le mobile, et inversement.
 *
 * Après : on garde 2 sessions actives en parallèle, une par plateforme.
 *  - current_mobile_session_id : dernière session mobile valide.
 *  - current_web_session_id    : dernière session dashboard valide.
 * Une nouvelle connexion mobile remplace uniquement la session mobile,
 * la web reste intacte (et symétriquement).
 *
 * On ajoute aussi `platform` sur refresh_token pour pouvoir cibler la purge
 * des tokens lors d'une re-login depuis la même plateforme.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.string('current_mobile_session_id', 64);
    table.string('current_web_session_id', 64);
  });

  await knex.schema.alterTable('refresh_token', (table) => {
    table.string('platform', 10);
  });

  // Backfill : on copie l'ancienne session vers `web` (hypothèse safe :
  // l'écrasante majorité des derniers logins sont des dashboards). Les
  // sessions mobiles encore actives devront re-login, ce qui est acceptable.
  await knex.raw(
    `UPDATE "user" SET current_web_session_id = current_session_id WHERE current_session_id IS NOT NULL`,
  );
  await knex.raw(`UPDATE refresh_token SET platform = 'web' WHERE platform IS NULL`);

  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('current_session_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.string('current_session_id', 64);
  });
  await knex.raw(
    `UPDATE "user" SET current_session_id = COALESCE(current_web_session_id, current_mobile_session_id)`,
  );
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('current_mobile_session_id');
    table.dropColumn('current_web_session_id');
  });
  await knex.schema.alterTable('refresh_token', (table) => {
    table.dropColumn('platform');
  });
};
