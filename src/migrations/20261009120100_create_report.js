/**
 * Signalements (repris de Buildr) : un message, une photo ou un membre jugé
 * déplacé, remonté aux administrateurs de l'organisation.
 *
 * La cible est désignée par son type et son identifiant, sans clé étrangère :
 * elle est souvent supprimée — c'est l'issue habituelle — et le signalement
 * doit survivre. `target_excerpt` fige ce qu'elle contenait.
 *
 * `escalated` : la personne visée est administratrice de l'organisation. Les
 * autres admins le voient, jamais elle, et il remonte à la console super admin.
 *
 * Les signalements déjà faits via `feedback` (type `report`, livrés le 07/10)
 * sont repris ici puis retirés de `feedback`, qui ne garde que bugs et
 * suggestions.
 */
const STATUS_FROM_FEEDBACK = { new: 'pending', in_progress: 'pending', resolved: 'resolved', declined: 'dismissed' };

exports.up = async function (knex) {
  await knex.schema.createTable('report', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('organization_id').notNullable().references('id').inTable('organization').onDelete('CASCADE');
    table.uuid('menage_id').nullable().references('id').inTable('menage').onDelete('SET NULL');
    table.uuid('reporter_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('target_type', 20).notNullable(); // comment | photo | user
    table.uuid('target_id').notNullable();
    table.uuid('target_user_id').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.text('target_excerpt').nullable();
    table.string('reason', 30).notNullable(); // inappropriate | harassment | off_topic | other
    table.text('comment').nullable();
    table.string('status', 20).notNullable().defaultTo('pending'); // pending | resolved | dismissed
    table.boolean('escalated').notNullable().defaultTo(false);
    table.uuid('resolved_by').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('resolved_at').nullable();
    table.text('resolution_note').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['organization_id', 'status'], 'idx_report_org_status');
    table.index(['target_type', 'target_id'], 'idx_report_target');
  });

  const legacy = await knex('feedback')
    .where({ type: 'report' })
    .whereNotNull('organization_id')
    .whereNotNull('target_type')
    .whereNotNull('target_id');
  for (const f of legacy) {
    const target =
      f.target_type === 'comment'
        ? await knex('comment').where({ id: f.target_id }).select('menage_id', 'author_id as user_id', 'content as excerpt').first()
        : await knex('photo').where({ id: f.target_id }).select('menage_id', 'uploaded_by as user_id', 'caption as excerpt').first();
    await knex('report').insert({
      organization_id: f.organization_id,
      menage_id: target?.menage_id ?? null,
      reporter_id: f.user_id,
      target_type: f.target_type,
      target_id: f.target_id,
      target_user_id: target?.user_id ?? null,
      target_excerpt: target?.excerpt ? String(target.excerpt).slice(0, 300) : null,
      reason: 'other',
      comment: f.message,
      status: STATUS_FROM_FEEDBACK[f.status] ?? 'pending',
      resolved_by: f.status === 'resolved' || f.status === 'declined' ? f.responded_by : null,
      resolved_at: f.status === 'resolved' || f.status === 'declined' ? f.responded_at : null,
      resolution_note: f.response,
      created_at: f.created_at,
      updated_at: f.updated_at,
    });
    await knex('feedback').where({ id: f.id }).delete();
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTable('report');
};
