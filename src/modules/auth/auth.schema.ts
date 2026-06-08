import { z } from 'zod';

// Politique mot de passe : min 12 caractères, au moins 1 lettre et 1 chiffre.
// (la longueur est le facteur clé ; pas d'obligation maj/symbole pour l'UX)
const passwordSchema = z
  .string()
  .min(12, 'Le mot de passe doit faire au moins 12 caractères')
  .max(128)
  .regex(/\p{L}/u, 'Le mot de passe doit contenir au moins une lettre')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre');

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema,
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  role: z.enum(['admin', 'prestataire']).optional().default('prestataire'),
  company_name: z.string().max(200).optional(),
  invitation_token: z.string().optional(),

  // Infos légales de la nouvelle organisation. Ignorées si invitation_token est fourni
  // (l'utilisateur rejoint une orga existante).
  organization: z
    .object({
      siret: z.string().regex(/^\d{14}$/).nullable().optional(),
      legal_form: z.string().max(50).nullable().optional(),
      vat_number: z.string().max(30).nullable().optional(),
      naf_code: z.string().regex(/^\d{4}[A-Z]$/i).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      postal_code: z.string().max(10).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      country: z.string().length(2).nullable().optional(),
      phone: z.string().max(20).nullable().optional(),
      billing_email: z.string().email().max(255).nullable().optional(),
      website: z.string().url().max(500).nullable().optional(),
    })
    .optional(),
  platform: z.enum(['mobile', 'web']).optional().default('web'),
});

export const updatePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

export const platformEnum = z.enum(['mobile', 'web']);
export type Platform = z.infer<typeof platformEnum>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  platform: platformEnum.optional().default('web'),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  new_password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
