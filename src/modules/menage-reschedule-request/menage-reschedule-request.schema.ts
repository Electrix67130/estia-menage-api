import { z } from 'zod';

export const rescheduleStatusEnum = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type RescheduleStatus = z.infer<typeof rescheduleStatusEnum>;

export const createRescheduleRequestSchema = z.object({
  menage_id: z.string().uuid(),
  proposed_date: z.string(), // YYYY-MM-DD
  proposed_time: z.string().optional(), // HH:MM[:SS]
  reason: z.string().max(2000).optional(),
});

export const decideRescheduleRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decision_reason: z.string().max(2000).optional(),
  /** Si approved, appliquer la nouvelle date au ménage (default true) */
  apply_to_menage: z.boolean().optional().default(true),
});

export const listRescheduleRequestsSchema = z.object({
  status: rescheduleStatusEnum.optional(),
  menage_id: z.string().uuid().optional(),
  requested_by: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateRescheduleRequest = z.infer<typeof createRescheduleRequestSchema>;
export type DecideRescheduleRequest = z.infer<typeof decideRescheduleRequestSchema>;
export type ListRescheduleRequestsQuery = z.infer<typeof listRescheduleRequestsSchema>;

export type RescheduleRequestRow = {
  id: string;
  menage_id: string;
  requested_by: string;
  original_date: string;
  proposed_date: string;
  proposed_time: string | null;
  reason: string | null;
  status: RescheduleStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
  updated_at: string;
};
