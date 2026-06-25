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

export const createLogementRoomSchema = z
  .object({
    logement_id: z.string().uuid(),
    // Le type pilote l'identification de la pièce (UI récente). Optionnel pour
    // rétro-compat : un ancien client mobile envoie seulement `name`.
    kind: roomKindEnum.optional(),
    // Nom auto-généré côté serveur depuis le type (« Salle de bain 1 ») quand un
    // `kind` non-« autre » est fourni ; requis sinon (type « autre » ou pas de type).
    name: z.string().min(1).max(200).optional(),
    photo_url: z.string().url().max(500).nullable().optional(),
    position: z.number().int().min(0).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (d) => (d.kind !== undefined && d.kind !== 'autre') || (typeof d.name === 'string' && d.name.trim().length > 0),
    { message: 'Un nom est requis (sauf si un type autre que « autre » est fourni)', path: ['name'] },
  );

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
