/**
 * Index partiel (organization_id, date_prevue) sur les ménages actifs.
 * Optimise les requêtes du calendrier qui filtrent par org + plage de dates,
 * cas le plus fréquent et qui n'avait pas d'index dédié.
 */
exports.up = function (knex) {
  return knex.schema.raw(
    `CREATE INDEX IF NOT EXISTS idx_menage_org_date_active
     ON menage (organization_id, date_prevue)
     WHERE archived_at IS NULL`,
  );
};

exports.down = function (knex) {
  return knex.schema.raw(`DROP INDEX IF EXISTS idx_menage_org_date_active`);
};
