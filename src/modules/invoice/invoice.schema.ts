import { z } from 'zod';

export const invoiceTypeEnum = z.enum(['invoice', 'quote']);
export type InvoiceType = z.infer<typeof invoiceTypeEnum>;

export const invoiceStatusEnum = z.enum([
  'draft',
  'sent',
  'paid',
  'cancelled',
  'accepted',
  'refused',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusEnum>;

/** Génère une facture/devis pour un client : soit une liste explicite de ménages,
 *  soit tous les ménages facturables du client sur une période. */
export const generateInvoiceSchema = z
  .object({
    client_id: z.string().uuid(),
    type: invoiceTypeEnum.default('invoice'),
    period_start: z.string().optional(), // YYYY-MM-DD
    period_end: z.string().optional(),
    menage_ids: z.array(z.string().uuid()).optional(),
    due_date: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => d.menage_ids?.length || (d.period_start && d.period_end), {
    message: 'Fournir menage_ids OU period_start + period_end',
  });
export type GenerateInvoice = z.infer<typeof generateInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  status: invoiceStatusEnum.optional(),
  due_date: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;

export const markProviderPaidSchema = z.object({
  menage_ids: z.array(z.string().uuid()).min(1),
  paid: z.boolean().default(true),
});
export type MarkProviderPaid = z.infer<typeof markProviderPaidSchema>;

export type InvoiceRow = {
  id: string;
  organization_id: string;
  client_id: string | null;
  type: InvoiceType;
  number: string | null;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  total_ht: string;
  total_tva: string;
  total_ttc: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  menage_id: string | null;
  label: string;
  quantity: string;
  unit_price_ht: string;
  vat_rate: string;
  line_ht: string;
  line_tva: string;
  line_ttc: string;
  position: number;
};
