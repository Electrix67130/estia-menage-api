import { z } from 'zod';

export const menageResponseStatusEnum = z.enum(['present', 'absent']);
export type MenageResponseStatus = z.infer<typeof menageResponseStatusEnum>;

export const upsertMenageResponseSchema = z.object({
  status: menageResponseStatusEnum,
  /** Réservé à l'admin : voter à la place d'un prestataire pour flipper son vote. */
  user_id: z.string().uuid().optional(),
});

export type UpsertMenageResponse = z.infer<typeof upsertMenageResponseSchema>;

export type MenageResponseRow = {
  id: string;
  menage_id: string;
  user_id: string;
  status: MenageResponseStatus;
  responded_at: string;
  created_at: string;
  updated_at: string;
};

/** Réponse enrichie avec infos user — pour la liste affichée à l'admin. */
export type MenageResponseWithUser = MenageResponseRow & {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/** Item de la liste "mes prochains ménages" pour un prestataire. */
export type MyUpcomingMenage = {
  id: string;
  logement_id: string;
  prestation_type: 'menage' | 'check_in' | 'check_out';
  logement_name: string | null;
  logement_address: string | null;
  logement_city: string | null;
  logement_color: string | null;
  date_prevue: string;
  horaire_prevu: string | null;
  duree_estimee_min: number | null;
  status: string;
  /** Calculé : jour passé + aucun pointage + statut a_venir. */
  needs_attention: boolean;
  /** Réponse personnelle du user appelant, null s'il n'a pas encore répondu. */
  my_response: MenageResponseStatus | null;
  /** true si le user est affecté à ce ménage (table menage_prestataire). */
  is_assigned: boolean;
  /** true si au moins un prestataire est affecté (peu importe lequel). */
  assigned_to_someone: boolean;
  /** Nom du prestataire référent (celui qui a fait / fera le ménage). */
  referent_first_name: string | null;
  referent_last_name: string | null;
  /** true si le référent est le user appelant. */
  done_by_me: boolean;
};

export const listMyMenagesSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  /**
   * `upcoming` (défaut) : ménages à venir (non `annule`/`valide`), date >= today.
   * `history` : ménages déjà faits (`termine`/`valide`), date <= today.
   */
  mode: z.enum(['upcoming', 'history']).optional().default('upcoming'),
});
