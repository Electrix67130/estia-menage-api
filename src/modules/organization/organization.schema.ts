import { z } from 'zod';

// Champs légaux et contact, partagés entre create/update.
// Tous optionnels : on n'oblige pas l'utilisateur à tout renseigner à la création
// pour ne pas freiner l'onboarding, mais ils sont demandés via le formulaire UI.
const legalFields = {
  siret: z.string().regex(/^\d{14}$/, 'SIRET invalide').nullable().optional(),
  legal_form: z.string().max(50).nullable().optional(),
  vat_number: z.string().max(30).nullable().optional(),
  naf_code: z.string().regex(/^\d{4}[A-Z]$/i, 'Code NAF invalide').nullable().optional(),

  address: z.string().max(500).nullable().optional(),
  postal_code: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().length(2).nullable().optional(),

  phone: z.string().max(20).nullable().optional(),
  billing_email: z.string().email().max(255).nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),

  logo_url: z.string().url().max(500).nullable().optional(),

  insurance_provider: z.string().max(200).nullable().optional(),
  insurance_number: z.string().max(100).nullable().optional(),
};

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  ...legalFields,
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  archive_retention_years: z.number().int().min(1).max(10).optional(),
  ...legalFields,
});

export type CreateOrganization = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;

export type OrganizationRow = {
  id: string;
  name: string;
  archive_retention_years: number;
  siret?: string | null;
  legal_form?: string | null;
  vat_number?: string | null;
  naf_code?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  billing_email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  insurance_provider?: string | null;
  insurance_number?: string | null;
  created_at: string;
  updated_at: string;
};
