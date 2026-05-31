import { z } from 'zod';

export const createClientSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    company_name: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).optional(),
    billing_address: z.string().max(500).optional(),
    postal_code: z.string().max(10).optional(),
    city: z.string().max(100).optional(),
    country: z.string().length(2).optional().default('FR'),
    siret: z.string().length(14).optional(),
    vat_number: z.string().max(30).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine(
    (data) =>
      Boolean(data.first_name) || Boolean(data.last_name) || Boolean(data.company_name),
    { message: 'Au moins un nom (personne ou entreprise) est obligatoire' },
  );

export const updateClientSchema = z.object({
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  company_name: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  billing_address: z.string().max(500).nullable().optional(),
  postal_code: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().length(2).optional(),
  siret: z.string().length(14).nullable().optional(),
  vat_number: z.string().max(30).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export type CreateClient = z.infer<typeof createClientSchema>;
export type UpdateClient = z.infer<typeof updateClientSchema>;

export type ClientRow = {
  id: string;
  organization_id: string;
  created_by: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  siret: string | null;
  vat_number: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
