import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  password_hash: z.string().min(1),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().max(500).optional(),
  role: z.enum(['admin', 'prestataire']).optional().default('prestataire'),
  company_name: z.string().max(200).optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().max(500).nullable().optional(),
  role: z.enum(['admin', 'prestataire']).optional(),
  company_name: z.string().max(200).optional(),
  /** Entreprise propre du prestataire — éditable par lui-même (non propagée). */
  provider_company: z.string().max(200).nullable().optional(),
  provider_siret: z.string().max(20).nullable().optional(),
  provider_vat_number: z.string().max(20).nullable().optional(),
  provider_address: z.string().max(300).nullable().optional(),
  is_active: z.boolean().optional(),
});

export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string | null;
  role: 'admin' | 'prestataire';
  company_name?: string;
  provider_company?: string | null;
  provider_siret?: string | null;
  provider_vat_number?: string | null;
  provider_address?: string | null;
  is_active: boolean;
  organization_id: string;
  created_at: string;
  updated_at: string;
};
