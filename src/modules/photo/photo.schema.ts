import { z } from 'zod';

export const createPhotoSchema = z
  .object({
    menage_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
    logement_id: z.string().uuid().optional(),
    logement_room_id: z.string().uuid().optional(),
    url: z.string().url().max(1000),
    thumbnail_url: z.string().url().max(1000).optional(),
    caption: z.string().max(500).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    taken_at: z.string(),
    file_size: z.coerce.number().int().positive().optional(),
    mime_type: z.string().max(50).optional(),
    is_degradation: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.menage_id) || Boolean(data.logement_id), {
    message: 'Une photo doit être rattachée à un ménage ou à un logement',
  });

export type CreatePhoto = z.infer<typeof createPhotoSchema>;

export type PhotoRow = {
  id: string;
  menage_id: string | null;
  section_id: string | null;
  logement_id: string | null;
  logement_room_id: string | null;
  uploaded_by: string;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  taken_at: string;
  file_size: number | null;
  mime_type: string | null;
  is_degradation: boolean;
  created_at: string;
  updated_at: string;
};
