import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema, resetPasswordSchema } from '@/modules/auth/auth.schema';

const base = {
  email: 'nina@test.local',
  first_name: 'Nina',
  last_name: 'Martin',
  phone: '0600000000',
};

describe('politique de mot de passe', () => {
  it('exige 12 caractères, une lettre et un chiffre — sans imposer majuscule ni symbole', () => {
    expect(registerSchema.safeParse({ ...base, password: 'motdepasse12' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: 'court1' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'sanschiffreici' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: '123456789012' }).success).toBe(false);
  });

  it('accepte les lettres accentuées comme lettres', () => {
    expect(registerSchema.safeParse({ ...base, password: 'étéàlaplage2026' }).success).toBe(true);
  });

  it('s’applique aussi à la réinitialisation', () => {
    expect(resetPasswordSchema.safeParse({ token: 't', new_password: 'court1' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 't', new_password: 'assezlong2026' }).success).toBe(true);
  });
});

describe('inscription', () => {
  it('est prestataire sur le web par défaut, et tolère les infos légales nulles', () => {
    const r = registerSchema.parse({
      ...base,
      password: 'motdepasse12',
      organization: { siret: null, country: 'FR', website: null },
    });
    expect(r.role).toBe('prestataire');
    expect(r.platform).toBe('web');
  });

  it('refuse un SIRET ou un code NAF mal formés', () => {
    const avec = (organization: Record<string, unknown>) =>
      registerSchema.safeParse({ ...base, password: 'motdepasse12', organization }).success;
    expect(avec({ siret: '123' })).toBe(false);
    expect(avec({ naf_code: '96.09Z' })).toBe(false);
    expect(avec({ siret: '12345678901234', naf_code: '9609Z' })).toBe(true);
  });
});

describe('connexion', () => {
  it('exige un e-mail valide et un mot de passe non vide', () => {
    expect(loginSchema.safeParse({ email: 'pas-un-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(loginSchema.parse({ email: 'a@b.co', password: 'x' }).platform).toBe('web');
  });
});
