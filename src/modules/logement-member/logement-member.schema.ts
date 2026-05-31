import { z } from 'zod';

export const logementMemberRoleEnum = z.enum(['manager', 'prestataire', 'client_proprietaire']);
export type LogementMemberRole = z.infer<typeof logementMemberRoleEnum>;

export const createLogementMemberSchema = z.object({
  logement_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: logementMemberRoleEnum,
  can_view_comments: z.boolean().optional(),
  can_view_photos: z.boolean().optional(),
  can_view_checklist: z.boolean().optional(),
  can_view_team: z.boolean().optional(),
  can_edit: z.boolean().optional(),
  can_view_prestataires: z.boolean().optional(),
  can_view_responsables: z.boolean().optional(),
  can_view_clients: z.boolean().optional(),
});

export const updateLogementMemberSchema = z.object({
  role: logementMemberRoleEnum.optional(),
  can_view_comments: z.boolean().optional(),
  can_view_photos: z.boolean().optional(),
  can_view_checklist: z.boolean().optional(),
  can_view_team: z.boolean().optional(),
  can_edit: z.boolean().optional(),
  can_view_prestataires: z.boolean().optional(),
  can_view_responsables: z.boolean().optional(),
  can_view_clients: z.boolean().optional(),
});

export type CreateLogementMember = z.infer<typeof createLogementMemberSchema>;
export type UpdateLogementMember = z.infer<typeof updateLogementMemberSchema>;

export type LogementMemberRow = {
  id: string;
  logement_id: string;
  user_id: string;
  role: LogementMemberRole;
  can_view_comments: boolean;
  can_view_photos: boolean;
  can_view_checklist: boolean;
  can_view_team: boolean;
  can_edit: boolean;
  /** Voir les autres prestataires du logement (par défaut false pour un prestataire) */
  can_view_prestataires: boolean;
  /** Voir les responsables/managers du logement */
  can_view_responsables: boolean;
  /** Voir le client de facturation du logement */
  can_view_clients: boolean;
  created_at: string;
  updated_at: string;
};
