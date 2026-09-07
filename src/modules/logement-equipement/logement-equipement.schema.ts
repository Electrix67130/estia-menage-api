import { z } from 'zod';

/**
 * Familles d'équipements. Sert au regroupement dans l'UI (dashboard + mobile)
 * et au catalogue de suggestions. Stockée en varchar : ajouter une famille ne
 * demande pas de migration.
 */
export const equipementCategoryEnum = z.enum([
  'cuisine',
  'electromenager',
  'confort',
  'exterieur',
  'loisirs',
  'bebe',
  'securite',
  'autre',
]);

export type EquipementCategory = z.infer<typeof equipementCategoryEnum>;

/** Libellé affichable d'une famille (source unique, partagée par les 2 apps). */
export const EQUIPEMENT_CATEGORY_LABELS: Record<EquipementCategory, string> = {
  cuisine: 'Cuisine',
  electromenager: 'Électroménager',
  confort: 'Confort',
  exterieur: 'Extérieur',
  loisirs: 'Loisirs',
  bebe: 'Bébé',
  securite: 'Sécurité',
  autre: 'Autre',
};

/**
 * Catalogue de suggestions (chips « ajout rapide » côté UI). Ce n'est PAS une
 * contrainte : l'admin peut saisir n'importe quel libellé libre. Exposé par
 * `GET /logement-equipements/catalog` pour que dashboard et mobile affichent
 * exactement la même liste sans la dupliquer.
 */
export const EQUIPEMENT_CATALOG: Record<EquipementCategory, string[]> = {
  cuisine: [
    'Plaque de cuisson',
    'Four',
    'Micro-ondes',
    'Appareil à raclette',
    'Appareil à fondue',
    'Crêpière',
    'Gaufrier',
    'Cafetière',
    'Machine à café à capsules',
    'Bouilloire',
    'Grille-pain',
    'Blender',
    'Robot de cuisine',
    'Hotte aspirante',
  ],
  electromenager: [
    'Lave-vaisselle',
    'Réfrigérateur',
    'Congélateur',
    'Lave-linge',
    'Sèche-linge',
    'Aspirateur',
    'Fer à repasser',
    'Table à repasser',
    'Étendoir à linge',
  ],
  confort: [
    'Télévision',
    'Box internet / Wi-Fi',
    'Climatisation',
    'Chauffage d\'appoint',
    'Cheminée',
    'Poêle à bois',
    'Ventilateur',
    'Sèche-cheveux',
    'Coffre-fort',
  ],
  exterieur: [
    'Barbecue',
    'Plancha',
    'Salon de jardin',
    'Parasol',
    'Transats',
    'Jacuzzi',
    'Piscine',
    'Tondeuse',
  ],
  loisirs: [
    'Jeux de société',
    'Console de jeux',
    'Enceinte Bluetooth',
    'Vélos',
    'Table de ping-pong',
    'Baby-foot',
  ],
  bebe: ['Lit parapluie', 'Chaise haute', 'Baignoire bébé', 'Barrière de sécurité', 'Poussette'],
  securite: [
    'Détecteur de fumée',
    'Extincteur',
    'Trousse de premiers secours',
    'Boîte à clés',
    'Alarme',
  ],
  autre: [],
};

export const createLogementEquipementSchema = z.object({
  logement_id: z.string().uuid(),
  label: z.string().min(1).max(200),
  category: equipementCategoryEnum.optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  logement_room_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const updateLogementEquipementSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  category: equipementCategoryEnum.nullable().optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  logement_room_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

/**
 * Ajout groupé depuis le catalogue : l'admin coche plusieurs chips d'un coup.
 * Les libellés déjà présents sur le logement sont ignorés (idempotent).
 */
export const bulkCreateLogementEquipementSchema = z.object({
  logement_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        category: equipementCategoryEnum.optional(),
        quantity: z.number().int().min(1).max(999).optional(),
        logement_room_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type CreateLogementEquipement = z.infer<typeof createLogementEquipementSchema>;
export type UpdateLogementEquipement = z.infer<typeof updateLogementEquipementSchema>;
export type BulkCreateLogementEquipement = z.infer<typeof bulkCreateLogementEquipementSchema>;

export type LogementEquipementRow = {
  id: string;
  logement_id: string;
  logement_room_id: string | null;
  label: string;
  category: EquipementCategory | null;
  quantity: number;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** Joint depuis `logement_room` (populé par findByLogement). */
  room_name?: string | null;
};
