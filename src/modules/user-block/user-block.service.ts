import { Knex } from 'knex';
import { BlockedUser } from './user-block.schema';

/**
 * Blocage entre utilisateurs (repris de Buildr). Personnel et silencieux :
 * seul celui qui bloque en voit l'effet, la personne bloquée n'est pas prévenue.
 */
class UserBlockService {
  constructor(private readonly db: Knex) {}

  async list(blockerId: string): Promise<BlockedUser[]> {
    return (await this.db('user_block')
      .join('user', 'user.id', 'user_block.blocked_id')
      .where('user_block.blocker_id', blockerId)
      .select('user_block.blocked_id as user_id', 'user.first_name', 'user.last_name', 'user_block.created_at')
      .orderBy('user_block.created_at', 'desc')) as BlockedUser[];
  }

  /** On ne bloque que quelqu'un avec qui on partage une organisation. */
  async sharesOrganization(userId: string, otherId: string): Promise<boolean> {
    const shared = await this.db('organization_member as mine')
      .join('organization_member as theirs', 'theirs.organization_id', 'mine.organization_id')
      .where('mine.user_id', userId)
      .where('theirs.user_id', otherId)
      .first();
    return !!shared;
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    await this.db('user_block')
      .insert({ blocker_id: blockerId, blocked_id: blockedId })
      .onConflict(['blocker_id', 'blocked_id'])
      .ignore();
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.db('user_block').where({ blocker_id: blockerId, blocked_id: blockedId }).del();
  }
}

export default UserBlockService;
