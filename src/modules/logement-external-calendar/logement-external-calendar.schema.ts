import { z } from 'zod';

export const externalCalendarProviderEnum = z.enum(['airbnb', 'booking', 'vrbo', 'ical']);
export type ExternalCalendarProvider = z.infer<typeof externalCalendarProviderEnum>;

export const createExternalCalendarSchema = z.object({
  logement_id: z.string().uuid(),
  provider: externalCalendarProviderEnum.optional().default('ical'),
  label: z.string().max(200).optional(),
  url: z.string().url().max(1000),
  enabled: z.boolean().optional().default(true),
});

export const updateExternalCalendarSchema = z.object({
  provider: externalCalendarProviderEnum.optional(),
  label: z.string().max(200).nullable().optional(),
  url: z.string().url().max(1000).optional(),
  enabled: z.boolean().optional(),
});

export type CreateExternalCalendar = z.infer<typeof createExternalCalendarSchema>;
export type UpdateExternalCalendar = z.infer<typeof updateExternalCalendarSchema>;

export type ExternalCalendarRow = {
  id: string;
  logement_id: string;
  provider: ExternalCalendarProvider;
  label: string | null;
  url: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export interface SyncResult {
  fetched_events: number;
  created_menages: number;
  updated_menages: number;
  cancelled_menages: number;
  error?: string;
}
