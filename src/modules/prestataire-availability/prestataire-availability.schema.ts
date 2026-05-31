import { z } from 'zod';

export const WEEKDAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const updateWeeklyAvailabilitySchema = z.object({
  monday: z.boolean().optional(),
  tuesday: z.boolean().optional(),
  wednesday: z.boolean().optional(),
  thursday: z.boolean().optional(),
  friday: z.boolean().optional(),
  saturday: z.boolean().optional(),
  sunday: z.boolean().optional(),
});

export const listWeeklyAvailabilitySchema = z.object({
  user_ids: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
});

export type UpdateWeeklyAvailability = z.infer<typeof updateWeeklyAvailabilitySchema>;

export type PrestataireWeeklyAvailabilityRow = {
  id: string;
  user_id: string;
  organization_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  created_at: string;
  updated_at: string;
};
