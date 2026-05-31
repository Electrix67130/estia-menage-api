import { z } from 'zod';

export const createCommentSchema = z.object({
  menage_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(5000),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
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
