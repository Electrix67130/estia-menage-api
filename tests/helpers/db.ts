import type { Knex } from 'knex';

let tableCache: string[] | null = null;

async function listTables(db: Knex): Promise<string[]> {
  if (tableCache) return tableCache;
  const rows = (await db('pg_tables')
    .where({ schemaname: 'public' })
    .whereNot('tablename', 'knex_migrations')
    .whereNot('tablename', 'knex_migrations_lock')
    .select('tablename')) as { tablename: string }[];
  tableCache = rows.map((r) => r.tablename);
  return tableCache;
}

/**
 * Vide toutes les tables metier entre deux tests.
 *
 * Un seul TRUNCATE pour l'ensemble : CASCADE traverse les cles etrangeres, et
 * les traiter d'un bloc evite d'avoir a trouver un ordre de suppression
 * compatible avec le graphe des dependances.
 */
export async function truncateAll(db: Knex): Promise<void> {
  const tables = await listTables(db);
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(', ');
  await db.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
