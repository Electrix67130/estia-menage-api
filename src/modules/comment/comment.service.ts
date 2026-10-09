import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import {
  CommentMention,
  CommentReactionSummary,
  CommentReplyPreview,
  CommentRow,
  MentionableUser,
  ReactionEmoji,
} from './comment.schema';
import { blockedIdsFor } from '@/lib/blocks';
import { signUrlsInList } from '@/lib/sign-url';
import { getMenageRecipientIds } from '@/lib/realtime-hub';

class CommentService extends BaseService<CommentRow> {
  constructor(db: Knex) {
    super(db, 'comment');
  }

  /**
   * Messages d'une prestation avec leur auteur, le message cité, les mentions
   * et les réactions agrégées du point de vue de `viewerId`. Les messages des
   * personnes qu'il a bloquées ne lui sont pas servis.
   */
  async findByMenage(
    menageId: string,
    options: PaginationOptions & { sectionId?: string | null | 'general'; viewerId?: string } = {},
  ): Promise<
    PaginatedResult<
      CommentRow & {
        first_name: string;
        last_name: string;
        avatar_url?: string;
        mentions: CommentMention[];
        reply_to: CommentReplyPreview | null;
        reactions: CommentReactionSummary[];
      }
    >
  > {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', sectionId, viewerId } = options;
    const offset = (page - 1) * limit;

    const blocked = await blockedIdsFor(this.db, viewerId);
    const baseQuery = this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .where('comment.menage_id', menageId)
      .modify((qb) => {
        if (blocked.length > 0) qb.whereNotIn('comment.author_id', blocked);
      });

    if (sectionId === 'general') {
      baseQuery.whereNull('comment.section_id');
    } else if (typeof sectionId === 'string') {
      baseQuery.where('comment.section_id', sectionId);
    }

    type Listed = CommentRow & { first_name: string; last_name: string; avatar_url?: string };
    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('comment.*', 'user.first_name', 'user.last_name', 'user.avatar_url')
        .orderBy(`comment.${orderBy}`, order)
        .limit(limit)
        .offset(offset) as Promise<Listed[]>,
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    const ids = items.map((c) => c.id);
    const [mentions, replies, reactions] = await Promise.all([
      this.mentionsByComment(ids),
      this.repliesFor(
        items.map((c) => c.reply_to_id).filter((id): id is string => !!id),
        blocked,
      ),
      this.reactionsFor(ids, viewerId),
    ]);
    const withMeta = items.map((c) => ({
      ...c,
      mentions: mentions.get(c.id) ?? [],
      reply_to: (c.reply_to_id && replies.get(c.reply_to_id)) || null,
      reactions: reactions.get(c.id) ?? [],
    }));

    return {
      data: signUrlsInList(withMeta, ['avatar_url']),
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /**
   * Les messages cités, en une requête. Ceux d'une personne bloquée sont omis :
   * la réponse d'un tiers s'affiche alors sans citation, sinon le contenu
   * bloqué reviendrait par ce biais.
   */
  private async repliesFor(ids: string[], blocked: string[] = []): Promise<Map<string, CommentReplyPreview>> {
    const map = new Map<string, CommentReplyPreview>();
    if (ids.length === 0) return map;
    const rows = (await this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .whereIn('comment.id', [...new Set(ids)])
      .modify((qb) => {
        if (blocked.length > 0) qb.whereNotIn('comment.author_id', blocked);
      })
      .select('comment.id', 'comment.content', 'comment.author_id', 'user.first_name', 'user.last_name')) as CommentReplyPreview[];
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  /** Réactions agrégées par message : nombre par emoji, et si le lecteur a réagi. */
  async reactionsFor(commentIds: string[], viewerId?: string): Promise<Map<string, CommentReactionSummary[]>> {
    const map = new Map<string, CommentReactionSummary[]>();
    if (commentIds.length === 0) return map;
    const rows = (await this.db('comment_reaction')
      .whereIn('comment_id', commentIds)
      .select('comment_id', 'emoji')
      .count('* as count')
      .select(this.db.raw('bool_or(user_id = ?) as mine', [viewerId ?? '00000000-0000-0000-0000-000000000000']))
      .groupBy('comment_id', 'emoji')
      .orderBy('emoji')) as unknown as { comment_id: string; emoji: ReactionEmoji; count: string; mine: boolean }[];
    for (const r of rows) {
      const arr = map.get(r.comment_id) ?? [];
      arr.push({ emoji: r.emoji, count: parseInt(r.count, 10), mine: r.mine });
      map.set(r.comment_id, arr);
    }
    return map;
  }

  /** Interrupteur : ajoute la réaction si elle n'y est pas, la retire sinon. Renvoie les réactions du message. */
  async toggleReaction(commentId: string, userId: string, emoji: ReactionEmoji): Promise<CommentReactionSummary[]> {
    const existing = await this.db('comment_reaction').where({ comment_id: commentId, user_id: userId, emoji }).first();
    if (existing) {
      await this.db('comment_reaction').where({ id: existing.id }).del();
    } else {
      await this.db('comment_reaction')
        .insert({ comment_id: commentId, user_id: userId, emoji })
        .onConflict(['comment_id', 'user_id', 'emoji'])
        .ignore();
    }
    return (await this.reactionsFor([commentId], userId)).get(commentId) ?? [];
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
