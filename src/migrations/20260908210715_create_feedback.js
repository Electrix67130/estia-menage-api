/**
 * Signalements des utilisateurs : bugs rencontrés et suggestions de
 * fonctionnalités.
 *
 * Le traitement se fait au niveau de l'**organisation** : les admins de l'org
 * voient les signalements de leurs membres et y répondent. Estia n'a pas (encore)
 * de console super-admin côté API, et le besoin immédiat est celui-là — un
 * prestataire qui remonte un problème à sa conciergerie.
 *
 * La réponse vit dans la même ligne plutôt que dans une table de messages : un
 * aller-retour suffit à l'usage visé. Passer à une vraie conversation demanderait
 * une table dédiée, et cette colonne s'y migrerait comme premier message.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());

    // Auteur. CASCADE : supprimer son compte efface ce qu'on a écrit.
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    // Organisation au moment de l'envoi : c'est elle qui traite le signalement.
    table
      .uuid('organization_id')
      .references('id')
      .inTable('organization')
      .onDelete('SET NULL');

    table.string('type', 20).notNullable(); // 'bug' | 'suggestion'
    table.string('subject', 150).notNullable();
    table.text('message').notNullable();
    table.string('status', 20).notNullable().defaultTo('new'); // new|in_progress|resolved|declined

    // Contexte technique renseigné par le client : sans lui, un bug mobile est
    // irreproductible.
    table.string('platform', 20); // 'mobile' | 'web'
    table.string('app_version', 40);
    table.string('screen', 200); // écran d'où le signalement part
    table.string('locale', 5).notNullable().defaultTo('fr'); // langue de rédaction

    // Réponse de l'admin, visible par l'auteur dans l'application.
    table.text('response');
    table.uuid('responded_by').references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('responded_at');

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    // La console trie par statut puis par date : la seule lecture fréquente.
    table.index(['organization_id', 'status', 'created_at'], 'idx_feedback_org_status');
    table.index(['user_id'], 'idx_feedback_user');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('feedback');
};
