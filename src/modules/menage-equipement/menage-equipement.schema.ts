import { z } from 'zod';

/**
 * Équipements du logement que l'admin demande de **préparer** pour une
 * prestation donnée (chaise haute, baignoire bébé, lit parapluie…). Le
 * prestataire les coche une fois sortis/installés.
 */
export const setMenageEquipementsSchema = z.object({
  items: z
    .array(
      z.object({
        logement_equipement_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99).optional(),
        notes: z.string().max(1000).nullable().optional(),
      }),
    )
    .max(100),
});

export const setMenageEquipementDoneSchema = z.object({
  done: z.boolean(),
});

export type SetMenageEquipements = z.infer<typeof setMenageEquipementsSchema>;
export type SetMenageEquipementDone = z.infer<typeof setMenageEquipementDoneSchema>;

export type MenageEquipementRow = {
  id: string;
  menage_id: string;
  logement_equipement_id: string;
  quantity: number;
  notes: string | null;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Ligne renvoyée par `GET /menages/:id/equipements` : la demande + l'équipement. */
export type MenageEquipementLine = MenageEquipementRow & {
  label: string;
  category: string | null;
  room_name: string | null;
  done_by_first_name: string | null;
  done_by_last_name: string | null;
};
