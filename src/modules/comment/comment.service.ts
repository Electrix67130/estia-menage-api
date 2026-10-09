import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { CommentMention, CommentRow, MentionableUser } from './comment.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { getMenageRecipientIds } from '@/lib/realtime-hub';

class CommentService extends BaseService<CommentRow> {
  constructor(db: Knex) {
    super(db, 'comment');
  }

  /** List comments for a menage with author info, optionally filtered by section_id */
  async findByMenage(
    menageId: string,
    options: PaginationOptions & { sectionId?: string | null | 'general' } = {},
  ): Promise<
    PaginatedResult<
      CommentRow & { first_name: string; last_name: string; avatar_url?: string; mentions: CommentMention[] }
    >
  > {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', sectionId } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .where('comment.menage_id', menageId);

    if (sectionId === 'general') {
      baseQuery.whereNull('comment.section_id');
    } else if (typeof sectionId === 'string') {
      baseQuery.where('comment.section_id', sectionId);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('comment.*', 'user.first_name', 'user.last_name', 'user.avatar_url')
        .orderBy(`comment.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    type Listed = CommentRow & { first_name: string; last_name: string; avatar_url?: string };
    const mentions = await this.mentionsByComment((items as Listed[]).map((c) => c.id));
    const withMentions = (items as Listed[]).map((c) => ({ ...c, mentions: mentions.get(c.id) ?? [] }));

    return {
      data: signUrlsInList(withMentions, ['avatar_url']),
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  async mentionsOf(commentId: string): Promise<CommentMention[]> {
    return (await this.mentionsByComment([commentId])).get(commentId) ?? [];
  }

  private async mentionsByComment(commentIds: string[]): Promise<Map<string, CommentMention[]>> {
    const byComment = new Map<string, CommentMention[]>();
    if (commentIds.length === 0) return byComment;
    const rows = (await this.db('comment_mention')
      .join('user', 'comment_mention.user_id', 'user.id')
      .whereIn('comment_mention.comment_id', commentIds)
      .select('comment_mention.comment_id', 'comment_mention.user_id', 'user.first_name', 'user.last_name')) as (
      CommentMention & { comment_id: string }
    )[];
    for (const { comment_id, ...mention } of rows) {
      byComment.set(comment_id, [...(byComment.get(comment_id) ?? []), mention]);
    }
    return byComment;
  }

  /**
   * Qui peut être mentionné : les personnes qui suivent la prestation (mêmes
   * destinataires que ses notifications — un presta non affecté n'en fait pas
   * partie), comptes actifs uniquement, hors soi-même.
   */
  async findMentionable(menageId: string, requesterId: string): Promise<MentionableUser[]> {
    const ids = await getMenageRecipientIds(this.db, menageId, requesterId);
    if (ids.length === 0) return [];
    const users = (await this.db('user')
      .whereIn('id', ids)
      .where({ is_active: true })
      .select('id', 'first_name', 'last_name', 'avatar_url')
      .orderBy([{ column: 'first_name' }, { column: 'last_name' }])) as MentionableUser[];
    return signUrlsInList(users, ['avatar_url']);
  }

  /**
   * Remplace les mentions d'un commentaire par celles qui sont légitimes (les
   * autres sont ignorées sans erreur) et renvoie les personnes nouvellement
   * mentionnées, à notifier.
   */
  async setMentions(
    commentId: string,
    menageId: string,
    authorId: string,
    requested: string[],
  ): Promise<string[]> {
    const allowed = new Set((await this.findMentionable(menageId, authorId)).map((u) => u.id));
    const wanted = [...new Set(requested)].filter((id) => allowed.has(id));
    const previous = new Set(
      ((await this.db('comment_mention').where({ comment_id: commentId }).select('user_id')) as { user_id: string }[]).map(
        (r) => r.user_id,
      ),
    );
    await this.db.transaction(async (trx) => {
      await trx('comment_mention').where({ comment_id: commentId }).whereNotIn('user_id', wanted).delete();
      const added = wanted.filter((id) => !previous.has(id));
      if (added.length > 0) {
        await trx('comment_mention').insert(added.map((user_id) => ({ comment_id: commentId, user_id })));
      }
    });
    return wanted.filter((id) => !previous.has(id));
  }
}

export default CommentService;
