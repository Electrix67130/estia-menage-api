import { z } from 'zod';

export const createLogementSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(10).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  n_bedrooms: z.number().int().min(0).max(50).default(0),
  n_bathrooms: z.number().int().min(0).max(50).default(0),
  n_wc: z.number().int().min(0).max(50).default(0),
  n_kitchens: z.number().int().min(0).max(10).default(1),
  n_living_rooms: z.number().int().min(0).max(10).default(1),
  n_exterior_spaces: z.number().int().min(0).max(10).default(0),
  has_basement: z.boolean().default(false),
  has_laundry: z.boolean().default(false),
  surface_m2: z.number().int().min(0).max(10000).optional(),
  notes: z.string().max(5000).optional(),
  proprietaire_user_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  key_safe_code: z.string().max(50).optional(),
  cover_photo_url: z.string().url().max(500).optional(),
  default_duration_min: z.number().int().min(0).max(1440).optional(),
  default_client_price_ht: z.number().min(0).max(100000).optional(),
  default_client_vat_rate: z.number().min(0).max(100).optional(),
  default_provider_price: z.number().min(0).max(100000).optional(),
  default_laundry_included: z.boolean().optional(),
  default_laundry_client_price_ht: z.number().min(0).max(100000).optional(),
  default_laundry_provider_price: z.number().min(0).max(100000).optional(),
  default_horaire_debut: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  default_horaire_fin: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/**
 * Update : tous les champs optional + champs "nullable" pour pouvoir
 * désassigner un client, vider une adresse, etc.
 */
export const updateLogementSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(10).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  n_bedrooms: z.number().int().min(0).max(50).optional(),
  n_bathrooms: z.number().int().min(0).max(50).optional(),
  n_wc: z.number().int().min(0).max(50).optional(),
  n_kitchens: z.number().int().min(0).max(10).optional(),
  n_living_rooms: z.number().int().min(0).max(10).optional(),
  n_exterior_spaces: z.number().int().min(0).max(10).optional(),
  has_basement: z.boolean().optional(),
  has_laundry: z.boolean().optional(),
  surface_m2: z.number().int().min(0).max(10000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  proprietaire_user_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  key_safe_code: z.string().max(50).nullable().optional(),
  cover_photo_url: z.string().url().max(500).nullable().optional(),
  default_duration_min: z.number().int().min(0).max(1440).nullable().optional(),
  default_client_price_ht: z.number().min(0).max(100000).nullable().optional(),
  default_client_vat_rate: z.number().min(0).max(100).nullable().optional(),
  default_provider_price: z.number().min(0).max(100000).nullable().optional(),
  default_laundry_included: z.boolean().optional(),
  default_laundry_client_price_ht: z.number().min(0).max(100000).nullable().optional(),
  default_laundry_provider_price: z.number().min(0).max(100000).nullable().optional(),
  default_horaire_debut: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  default_horaire_fin: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export type CreateLogement = z.infer<typeof createLogementSchema>;
export type UpdateLogement = z.infer<typeof updateLogementSchema>;

export type LogementRow = {
  id: string;
  organization_id: string;
  created_by: string;
  proprietaire_user_id: string | null;
  client_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  n_bedrooms: number;
  n_bathrooms: number;
  n_wc: number;
  n_kitchens: number;
  n_living_rooms: number;
  n_exterior_spaces: number;
  has_basement: boolean;
  has_laundry: boolean;
  surface_m2: number | null;
  notes: string | null;
  key_safe_code: string | null;
  cover_photo_url: string | null;
  default_duration_min: number | null;
  default_client_price_ht: number | string | null;
  default_client_vat_rate: number | string | null;
  default_provider_price: number | string | null;
  default_laundry_included: boolean;
  default_laundry_client_price_ht: number | string | null;
  default_laundry_provider_price: number | string | null;
  default_horaire_debut: string | null;
  default_horaire_fin: string | null;
  color: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
