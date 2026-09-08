import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Environnement des tests.
 *
 * Ces valeurs sont posees dans `process.env` AVANT que quoi que ce soit
 * n'importe `@/config/env`. C'est ce qui neutralise le `.env` du poste :
 * dotenv n'ecrase jamais une variable deja definie, donc la base de test gagne
 * toujours sur la base de developpement.
 *
 * SMTP est explicitement vide : sans lui, `sendMail()` se contente de
 * journaliser. Aucun test ne peut envoyer un vrai e-mail.
 */
const TEST_ENV = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5434',
  DB_NAME: 'estia_test',
  DB_USER: 'postgres',
  DB_PASSWORD: 'postgres',
  JWT_SECRET: 'secret-de-test',
  API_KEY: 'cle-de-test',
  SMTP_HOST: '',
  APP_URL: 'http://localhost:3001',
  STORAGE_MODE: 'local',
};

// Pour le processus principal (global setup : migrations).
Object.assign(process.env, TEST_ENV);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Les fichiers d'integration partagent UNE base et la vident avant chaque
    // test : ils doivent s'executer l'un apres l'autre. En vitest 3, l'option
    // n'est lue qu'a la racine — la poser seulement dans le projet laissait les
    // fichiers se marcher dessus (connexions refusees, cles etrangeres violees).
    fileParallelism: false,
    // Deux etages separes : les unitaires ne touchent pas la base et tournent
    // sans docker, l'integration demarre le conteneur et applique les
    // migrations. Les separer evite d'exiger une base pour verifier une
    // fonction pure.
    projects: [
      {
        // Les plugins sont redéclarés par projet : contrairement à vitest 4+,
        // vitest 3 ne les fait pas descendre du niveau racine, et sans
        // `tsconfigPaths` les imports `@/…` ne se résolvent pas.
        plugins: [tsconfigPaths()],
        test: {
          name: 'unitaires',
          include: ['tests/unit/**/*.test.ts'],
          env: TEST_ENV,
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          env: TEST_ENV,
          globalSetup: ['./tests/global-setup.ts'],
          // `@fastify/autoload` decouvre les modules par import() a l'execution.
          // Sans cette ligne, cet import echappe au transformeur et Node bute
          // sur du TypeScript brut.
          server: { deps: { inline: ['@fastify/autoload'] } },
          // Une seule base pour toute la suite, et chaque test la vide avant de
          // commencer : les fichiers doivent donc s'executer l'un apres l'autre.
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
