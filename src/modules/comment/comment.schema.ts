import { z } from 'zod';

/**
 * Les réactions possibles (reprises de Buildr). Une liste fermée plutôt qu'un
 * emoji libre : les compteurs se regroupent par emoji. Les clients affichent
 * cette même rangée.
 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const createCommentSchema = z.object({
  menage_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(5000),
  /** Personnes mentionnées (« @Prénom Nom ») ; filtrées côté serveur sur celles qui suivent la prestation. */
  mentioned_user_ids: z.array(z.string().uuid()).max(20).optional(),
  /** Message auquel on répond : il doit appartenir à la même prestation. */
  reply_to_id: z.string().uuid().nullable().optional(),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  /** Remplace la liste des mentions ; seules les nouvelles sont notifiées. */
  mentioned_user_ids: z.array(z.string().uuid()).max(20).optional(),
});

export type CreateComment = z.infer<typeof createCommentSchema>;
export type UpdateComment = z.infer<typeof updateCommentSchema>;

export type CommentRow = {
  id: string;
  menage_id: string;
  section_id: string | null;
  author_id: string;
  content: string;
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Le message cité, tel qu'affiché au-dessus d'une réponse. */
export type CommentReplyPreview = {
  id: string;
  content: string;
  author_id: string;
  first_name: string;
  last_name: string;
};

/** Une réaction agrégée : combien de personnes, et si le lecteur en est. */
export type CommentReactionSummary = {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
};

export type CommentMention = { user_id: string; first_name: string; last_name: string };

/** Personne qu'on peut mentionner sur une prestation. */
export type MentionableUser = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
};
