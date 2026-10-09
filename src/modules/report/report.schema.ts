import { z } from 'zod';

/** Ce qu'on peut signaler. */
export const REPORT_TARGETS = ['comment', 'photo', 'user'] as const;
/** Pourquoi. Une liste fermée : les motifs se comptent et se traduisent. */
export const REPORT_REASONS = ['inappropriate', 'harassment', 'off_topic', 'other'] as const;
/** Cycle de vie : en attente, traité (on a agi), rejeté (rien à redire). */
export const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const createReportSchema = z.object({
  target_type: z.enum(REPORT_TARGETS),
  target_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  comment: z.string().trim().max(2000).optional(),
});

export const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution_note: z.string().trim().max(2000).optional(),
});

export const listReportsSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  menage_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateReport = z.infer<typeof createReportSchema>;
export type ResolveReport = z.infer<typeof resolveReportSchema>;
export type ListReports = z.infer<typeof listReportsSchema>;

export type ReportRow = {
  id: string;
  organization_id: string;
  menage_id: string | null;
  reporter_id: string;
  target_type: ReportTarget;
  target_id: string;
  target_user_id: string | null;
  target_excerpt: string | null;
  reason: ReportReason;
  comment: string | null;
  status: ReportStatus;
  escalated: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

/** Un signalement tel qu'affiché à celui qui le traite. */
export type ReportWithContext = ReportRow & {
  reporter_first_name: string;
  reporter_last_name: string;
  target_first_name: string | null;
  target_last_name: string | null;
  logement_name: string | null;
  menage_date: string | null;
  organization_name: string;
  /** La cible existe-t-elle encore ? Faux une fois le message ou la photo supprimé. */
  target_exists: boolean;
};
