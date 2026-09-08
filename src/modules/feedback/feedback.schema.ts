import { z } from 'zod';

/** Nature du signalement. */
export const FEEDBACK_TYPES = ['bug', 'suggestion'] as const;
/** Cycle de vie côté admin. */
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved', 'declined'] as const;

export const createFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(10).max(5000),
  /** Contexte technique, facultatif : le client le renseigne s'il le connaît. */
  platform: z.enum(['mobile', 'web']).optional(),
  app_version: z.string().max(40).optional(),
  screen: z.string().max(200).optional(),
  /** Langue de rédaction — c'est dans celle-là qu'il faut répondre. */
  locale: z.enum(['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl']).optional(),
});

/**
 * Traitement d'un signalement par un admin. Les deux champs sont facultatifs
 * mais pas la requête : un appel vide ne ferait que toucher `updated_at`.
 */
export const respondFeedbackSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    response: z.string().trim().min(1).max(5000).nullable().optional(),
  })
  .refine((d) => d.status !== undefined || d.response !== undefined, {
    message: 'Renseignez au moins un statut ou une réponse',
  });

export const listFeedbackSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
  /** Recherche libre : sujet, message, e-mail de l'auteur. */
  q: z.string().trim().max(200).optional(),
});

export type CreateFeedback = z.infer<typeof createFeedbackSchema>;
export type RespondFeedback = z.infer<typeof respondFeedbackSchema>;
export type ListFeedback = z.infer<typeof listFeedbackSchema>;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackRow = {
  id: string;
  user_id: string;
  organization_id: string | null;
  type: FeedbackType;
  subject: string;
  message: string;
  status: FeedbackStatus;
  platform: string | null;
  app_version: string | null;
  screen: string | null;
  locale: string;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};
