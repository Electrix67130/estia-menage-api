import { z } from 'zod';

export const createLogementConsommableSchema = z.object({
  logement_id: z.string().uuid(),
  label: z.string().min(1).max(200),
  unit: z.string().max(30).nullable().optional(),
  seuil_alerte: z.number().int().min(0).optional(),
  position: z.number().int().min(0).optional(),
});

export const updateLogementConsommableSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  unit: z.string().max(30).nullable().optional(),
  seuil_alerte: z.number().int().min(0).optional(),
  position: z.number().int().min(0).optional(),
});

// Relevé au pointage de fin : la liste complète des quantités restantes.
export const setReleveSchema = z.object({
  items: z
    .array(
      z.object({
        logement_consommable_id: z.string().uuid(),
        qty: z.number().int().min(0),
      }),
    )
    .min(1),
});

export type CreateLogementConsommable = z.infer<typeof createLogementConsommableSchema>;
export type UpdateLogementConsommable = z.infer<typeof updateLogementConsommableSchema>;
export type SetReleve = z.infer<typeof setReleveSchema>;

export type LogementConsommableRow = {
  id: string;
  logement_id: string;
  label: string;
  unit: string | null;
  seuil_alerte: number;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MenageConsommableReleveRow = {
  id: string;
  menage_id: string;
  logement_consommable_id: string;
  qty: number;
  recorded_by: string | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
};

/**
 * Ligne renvoyée par GET /menages/:id/consommables : le consommable + sa
 * quantité relevée pour ce ménage (null si pas encore saisi) + le flag dérivé.
 */
export type MenageConsommableLine = {
  logement_consommable_id: string;
  label: string;
  unit: string | null;
  seuil_alerte: number;
  position: number;
  qty: number | null;
  needs_restock: boolean; // qty != null && qty <= seuil_alerte
};
