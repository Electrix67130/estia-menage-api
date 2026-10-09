import { z } from 'zod';

export const createCommentSchema = z.object({
  menage_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(5000),
  /** Personnes mentionnées (« @Prénom Nom ») ; filtrées côté serveur sur celles qui suivent la prestation. */
  mentioned_user_ids: z.array(z.string().uuid()).max(20).optional(),
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
  created_at: string;
  updated_at: string;
};

export type CommentMention = { user_id: string; first_name: string; last_name: string };

/** Personne qu'on peut mentionner sur une prestation. */
export type MentionableUser = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
};
