import path from 'path';
import knex from 'knex';

/**
 * Prepare la base de test une fois pour toute la suite : verifie qu'on parle
 * bien a une base jetable, puis applique les migrations.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/migrations');

function assertDisposableDatabase(): void {
  const name = process.env.DB_NAME ?? '';
  const port = process.env.DB_PORT ?? '';
  const host = process.env.DB_HOST ?? '';

  // Les tests vident les tables. Se tromper de base coute une base de
  // developpement — ou pire. On refuse de demarrer si la cible n'est pas
  // manifestement jetable.
  if (!name.endsWith('_test')) {
    throw new Error(`Base de test refusee : DB_NAME="${name}" ne se termine pas par "_test".`);
  }
  if (port !== '5434') {
    throw new Error(`Base de test refusee : DB_PORT="${port}" (attendu 5434, celui du conteneur de test).`);
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Base de test refusee : DB_HOST="${host}" n'est pas local.`);
  }
}

export async function setup(): Promise<void> {
  assertDisposableDatabase();

  const db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
    migrations: { directory: MIGRATIONS_DIR, tableName: 'knex_migrations' },
  });

  try {
    await db.raw('SELECT 1');
  } catch {
    await db.destroy();
    throw new Error(
      'Base de test injoignable sur 127.0.0.1:5434.\n' +
        'Demarrez-la avec : npm run test:db:up',
    );
  }

  await db.migrate.latest();
  await db.destroy();
}
