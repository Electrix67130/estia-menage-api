import { z } from 'zod';

export const menageStatusEnum = z.enum(['a_venir', 'en_cours', 'termine', 'valide', 'annule']);
export type MenageStatus = z.infer<typeof menageStatusEnum>;

export const createMenageSchema = z.object({
  logement_id: z.string().uuid(),
  prestataire_user_id: z.string().uuid().optional(),
  date_prevue: z.string(), // YYYY-MM-DD
  horaire_prevu: z.string().optional(), // HH:MM[:SS] — début de la tranche
  horaire_fin_prevu: z.string().optional(), // HH:MM[:SS] — fin de la tranche
  duree_estimee_min: z.number().int().min(0).max(1440).optional(),
  prix_prevu: z.number().min(0).max(100000).optional(),
  client_price_ht: z.number().min(0).max(100000).optional(),
  client_vat_rate: z.number().min(0).max(100).optional(),
  provider_price: z.number().min(0).max(100000).optional(),
  currency: z.string().length(3).optional(),
  laundry_included: z.boolean().optional(),
  laundry_client_price_ht: z.number().min(0).max(100000).optional(),
  laundry_provider_price: z.number().min(0).max(100000).optional(),
  notes_intervention: z.string().max(5000).optional(),
});

export const updateMenageSchema = z.object({
  prestataire_user_id: z.string().uuid().nullable().optional(),
  date_prevue: z.string().optional(),
  horaire_prevu: z.string().nullable().optional(),
  horaire_fin_prevu: z.string().nullable().optional(),
  duree_estimee_min: z.number().int().min(0).max(1440).nullable().optional(),
  prix_prevu: z.number().min(0).max(100000).nullable().optional(),
  client_price_ht: z.number().min(0).max(100000).nullable().optional(),
  client_vat_rate: z.number().min(0).max(100).nullable().optional(),
  provider_price: z.number().min(0).max(100000).nullable().optional(),
  currency: z.string().length(3).optional(),
  laundry_included: z.boolean().optional(),
  laundry_client_price_ht: z.number().min(0).max(100000).nullable().optional(),
  laundry_provider_price: z.number().min(0).max(100000).nullable().optional(),
  notes_intervention: z.string().max(5000).nullable().optional(),
  status: menageStatusEnum.optional(),
  // Édition manuelle des timestamps de pointage (admin only — contrôle côté route).
  // Format ISO 8601 ("2026-05-18T14:30:00.000Z") ou null pour effacer.
  arrived_at: z.string().datetime().nullable().optional(),
  departed_at: z.string().datetime().nullable().optional(),
  /** Déverrouille la date pour ré-autoriser la sync iCal (admin only). */
  date_locked: z.boolean().optional(),
});

export const validateReportSchema = z.object({
  price: z.number().min(0).max(100000).optional(),
});

/**
 * Body du pointage (arrivée/départ) : photo géolocalisée obligatoire pour
 * prouver la présence du prestataire sur place.
 */
export const pointageSchema = z.object({
  photo_url: z.string().url().max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const listMenagesSchema = z.object({
  status: menageStatusEnum.optional(),
  prestataire_user_id: z.string().uuid().optional(),
  logement_id: z.string().uuid().optional(),
  validated: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : v))
    .optional(),
  unassigned: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : v))
    .optional(),
  manager: z.literal('me').optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  orderBy: z.string().optional().default('date_prevue'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type CreateMenage = z.infer<typeof createMenageSchema>;
export type UpdateMenage = z.infer<typeof updateMenageSchema>;
export type ValidateReport = z.infer<typeof validateReportSchema>;
export type Pointage = z.infer<typeof pointageSchema>;
export type ListMenagesQuery = z.infer<typeof listMenagesSchema>;

export type MenageRow = {
  id: string;
  logement_id: string;
  organization_id: string;
  created_by: string;
  prestataire_user_id: string | null;
  status: MenageStatus;
  date_prevue: string;
  /** True quand la date a été manuellement override → la sync iCal ne l'écrase plus. */
  date_locked: boolean;
  horaire_prevu: string | null;
  horaire_fin_prevu: string | null;
  duree_estimee_min: number | null;
  date_realisation: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  external_calendar_id: string | null;
  arrival_photo_url: string | null;
  arrival_lat: number | string | null;
  arrival_lng: number | string | null;
  departure_photo_url: string | null;
  departure_lat: number | string | null;
  departure_lng: number | string | null;
  prix_prevu: number | string | null;
  client_price_ht: number | string | null;
  client_vat_rate: number | string | null;
  provider_price: number | string | null;
  currency: string;
  laundry_included: boolean;
  laundry_client_price_ht: number | string | null;
  laundry_provider_price: number | string | null;
  validated_at: string | null;
  validated_by: string | null;
  validated_price: number | string | null;
  notes_intervention: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined fields from `user` table on prestataire_user_id (populated by findActive) */
  prestataire_first_name?: string | null;
  prestataire_last_name?: string | null;
  prestataire_avatar_url?: string | null;
  /** Joined fields from `logement` table (populated by findActive / findByIdWithPrestataire) */
  logement_name?: string | null;
  logement_address?: string | null;
  logement_city?: string | null;
  logement_color?: string | null;
  logement_latitude?: number | string | null;
  logement_longitude?: number | string | null;
  /** True s'il existe au moins une demande de report `pending` sur ce ménage. */
  has_pending_reschedule?: boolean;
};

/**
 * Champs financiers réservés aux roles admin / manager (et au prestataire pour ses propres montants).
 * Un prestataire ne doit JAMAIS voir le prix facturé client.
 */
export const ADMIN_ONLY_FINANCIAL_FIELDS = [
  'client_price_ht',
  'client_vat_rate',
  'laundry_client_price_ht',
] as const;

export function serializeMenageForRole(
  menage: MenageRow,
  opts: { isAdmin: boolean; isPrestataire: boolean },
): Partial<MenageRow> {
  if (opts.isAdmin) return menage;
  const out: Partial<MenageRow> = { ...menage };
  for (const field of ADMIN_ONLY_FINANCIAL_FIELDS) {
    delete (out as Record<string, unknown>)[field];
  }
  // Si non-prestataire et non-admin (membre logement simple), masquer aussi le provider_price
  if (!opts.isPrestataire) {
    delete (out as Record<string, unknown>).provider_price;
    delete (out as Record<string, unknown>).laundry_provider_price;
  }
  return out;
}
