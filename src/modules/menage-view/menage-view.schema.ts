import { z } from 'zod';

/**
 * Onglets suivis pour les badges « non-lus ». Seuls `comments`,
 * `comments_steps` et `photos` sont adossés à une entité existante et donc
 * réellement comptés ; `documents`, `emergencies`, `emergencies_claim`
 * renvoient toujours 0 tant que ces entités n'existent pas côté API.
 */
export const menageTabEnum = z.enum([
  'comments',
  'comments_steps',
  'photos',
  'documents',
  'emergencies',
  'emergencies_claim',
]);
export type MenageTab = z.infer<typeof menageTabEnum>;

export const markTabViewedSchema = z.object({
  menage_id: z.string().uuid(),
  tab: menageTabEnum,
});
export type MarkTabViewed = z.infer<typeof markTabViewedSchema>;

export const markItemViewedSchema = z.object({
  item_type: z.enum(['step', 'emergency']),
  item_id: z.string().uuid(),
});
export type MarkItemViewed = z.infer<typeof markItemViewedSchema>;

export const unreadQuerySchema = z.object({
  menage_id: z.string().uuid(),
});

export type MenageViewRow = {
  id: string;
  user_id: string;
  menage_id: string;
  tab: MenageTab;
  last_viewed_at: string;
  created_at: string;
  updated_at: string;
};

export type UnreadCounts = {
  comments: number;
  comments_steps: number;
  photos: number;
  documents: number;
  emergencies: number;
  emergencies_claim: number;
  unread_step_ids: string[];
  unread_emergency_ids: string[];
  /** Dernière consultation de l'onglet commentaires (général) — null si jamais
   * consulté. Permet au client de marquer chaque commentaire postérieur comme
   * non lu. */
  comments_last_viewed_at: string | null;
};

export type UnreadSummary = {
  by_menage: Record<string, number>;
  by_organization: Record<string, number>;
  /** Total des non-lus ventilé par type de prestation (menage / check_in /
   * check_out) → chaque item de nav affiche son propre badge. */
  by_type: Record<string, number>;
};
