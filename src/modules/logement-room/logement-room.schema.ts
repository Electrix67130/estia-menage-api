import { z } from 'zod';

export const roomKindEnum = z.enum([
  'chambre',
  'salle_de_bain',
  'wc',
  'cuisine',
  'salon',
  'salle_a_manger',
  'bureau',
  'entree',
  'couloir',
  'exterieur',
  'cave',
  'buanderie',
  'piscine',
  'jacuzzi',
  'autre',
]);

export type RoomKind = z.infer<typeof roomKindEnum>;

export const createLogementRoomSchema = z.object({
  logement_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  // `kind` conservé pour rétro-compat, plus imposé : pièces 100% libres (nom + photo).
  kind: roomKindEnum.optional(),
  photo_url: z.string().url().max(500).nullable().optional(),
  position: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLogementRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  kind: roomKindEnum.nullable().optional(),
  photo_url: z.string().url().max(500).nullable().optional(),
  position: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateLogementRoom = z.infer<typeof createLogementRoomSchema>;
export type UpdateLogementRoom = z.infer<typeof updateLogementRoomSchema>;

export type LogementRoomRow = {
  id: string;
  logement_id: string;
  name: string;
  kind: RoomKind | null;
  photo_url: string | null;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
