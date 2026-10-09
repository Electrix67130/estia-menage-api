import { Knex } from 'knex';

/**
 * Les personnes que `viewerId` a bloquées. Les listes de messages et de
 * photos s'en servent pour ne pas lui montrer leur contenu. Une liste vide
 * laisse les requêtes intactes : c'est le cas de presque tout le monde.
 */
export async function blockedIdsFor(db: Knex, viewerId: string | undefined): Promise<string[]> {
  if (!viewerId) return [];
  const rows = (await db('user_block').where({ blocker_id: viewerId }).select('blocked_id')) as { blocked_id: string }[];
  return rows.map((r) => r.blocked_id);
}
