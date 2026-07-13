import { z } from 'zod';

export const setMenagePrestatairesSchema = z.object({
  /**
   * Liste complète des prestataires affectés au ménage (full-replace).
   * Vide = tout désaffecter. Premier UUID = devient le "prestataire principal"
   * (denormalisé dans `menage.prestataire_user_id` pour rétro-compat).
   */
  prestataire_user_ids: z.array(z.string().uuid()).max(20),
});

export type SetMenagePrestataires = z.infer<typeof setMenagePrestatairesSchema>;

export type MenagePrestataireRow = {
  id: string;
  menage_id: string;
  user_id: string;
  created_at: string;
};

/** Row enrichie avec les infos user pour la liste affichée à l'admin / UI. */
export type MenagePrestataireWithUser = MenagePrestataireRow & {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  avatar_thumbnail_url: string | null;
  is_primary: boolean;
};
