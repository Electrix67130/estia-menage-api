/**
 * Console super admin (reprise du modèle Buildr) :
 *  - `user.is_super_admin` : le drapeau se pose à la main en SQL, jamais via l'API.
 *  - `organization.is_active` : kill switch d'une organisation.
 *  - `audit_log` : qui a fait quoi en tant que super admin (toute action est tracée).
 *  - `error_log` : les 500 de l'API. `src/plugins/error-handler.ts` écrivait déjà
 *    dedans sans qu'aucune migration ne la crée.
 *
 * Tout est conditionnel : `error_log` **existe déjà en production**, créée hors
 * migrations. Une migration qui la recrée aveuglément échoue (« relation already
 * exists ») et, knex jouant le lot dans UNE transaction, annule aussi les
 * migrations précédentes du même déploiement.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('user', 'is_super_admin'))) {
    await knex.schema.alterTable('user', (table) => {
      table.boolean('is_super_admin').notNullable().defaultTo(false).index();
    });
  }

  if (!(await knex.schema.hasColumn('organization', 'is_active'))) {
    await knex.schema.alterTable('organization', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true);
    });
  }

  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.uuid('super_admin_id').notNullable().references('user.id').onDelete('CASCADE');
      table.string('action', 100).notNullable(); // ex : 'org.disable', 'user.kick_sessions'
      table.string('target_type', 50); // ex : 'organization', 'user', 'feedback'
      table.uuid('target_id');
      table.jsonb('metadata');
      table.string('ip', 45);
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

      table.index(['super_admin_id', 'created_at']);
      table.index(['target_type', 'target_id']);
    });
  }

  if (!(await knex.schema.hasTable('error_log'))) {
    await knex.schema.createTable('error_log', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.string('level', 10).notNullable(); // 'error' | 'warn'
      table.text('message').notNullable();
      table.text('stack');
      table.string('route', 500);
      table.string('method', 10);
      table.uuid('user_id').references('user.id').onDelete('SET NULL');
      table.integer('status_code');
      table.string('request_id', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable().index();
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('error_log');
  await knex.schema.dropTableIfExists('audit_log');
  if (await knex.schema.hasColumn('organization', 'is_active')) {
    await knex.schema.alterTable('organization', (table) => {
      table.dropColumn('is_active');
    });
  }
  if (await knex.schema.hasColumn('user', 'is_super_admin')) {
    await knex.schema.alterTable('user', (table) => {
      table.dropColumn('is_super_admin');
    });
  }
};
