import { z } from 'zod';

/**
 * Suggestions de packs (chips d'aide à la saisie, servies par l'API pour que
 * dashboard et mobile proposent la même liste). Le libellé reste libre.
 */
export const OPTION_SUGGESTIONS = [
  'Pack romantique',
  'Pack anniversaire',
  'Pack bébé',
  'Panier gourmand',
  'Bouteille de champagne',
  'Fleurs fraîches',
  'Décoration ballons',
  'Petit-déjeuner',
] as const;

export const createLogementOptionSchema = z.object({
  logement_id: z.string().uuid(),
  label: z.string().min(1).max(150),
  description: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const updateLogementOptionSchema = z.object({
  label: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

/** Options retenues pour une prestation (remplace la liste). */
export const setMenageOptionsSchema = z.object({
  items: z
    .array(
      z.object({
        logement_option_id: z.string().uuid(),
        notes: z.string().max(1000).nullable().optional(),
      }),
    )
    .max(50),
});

export type CreateLogementOption = z.infer<typeof createLogementOptionSchema>;
export type UpdateLogementOption = z.infer<typeof updateLogementOptionSchema>;
export type SetMenageOptions = z.infer<typeof setMenageOptionsSchema>;

export type LogementOptionRow = {
  id: string;
  logement_id: string;
  label: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type MenageOptionRow = {
  id: string;
  menage_id: string;
  logement_option_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Ligne renvoyée par `GET /menages/:id/options` : le lien + l'option. */
export type MenageOptionLine = MenageOptionRow & {
  label: string;
  description: string | null;
};
