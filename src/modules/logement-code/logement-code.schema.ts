import { z } from 'zod';

/** Libellé proposé par défaut quand un code arrive par le champ legacy. */
export const DEFAULT_CODE_LABEL = 'Boîte à clés';

/**
 * Suggestions de libellés (chips côté UI, dashboard + mobile). Aide à la
 * saisie uniquement : le libellé reste totalement libre.
 */
export const CODE_LABEL_SUGGESTIONS = [
  'Boîte à clés',
  'Portail',
  'Porte d’entrée',
  'Immeuble',
  'Alarme',
  'Garage',
  'Local poubelles',
  'Wi-Fi',
] as const;

export const createLogementCodeSchema = z.object({
  logement_id: z.string().uuid(),
  label: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const updateLogementCodeSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(100).optional(),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export type CreateLogementCode = z.infer<typeof createLogementCodeSchema>;
export type UpdateLogementCode = z.infer<typeof updateLogementCodeSchema>;

export type LogementCodeRow = {
  id: string;
  logement_id: string;
  label: string;
  code: string;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};
