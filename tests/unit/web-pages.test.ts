import { describe, expect, it } from 'vitest';
import {
  renderInvitePage,
  renderPrivacyPage,
  renderResetPasswordPage,
  renderSupportPage,
} from '@/lib/web-pages';

describe('page pont d’invitation', () => {
  it('tente le lien profond vers l’application et propose un repli', () => {
    const html = renderInvitePage('abc-123');
    expect(html).toContain('href="estia-clean-connect://invite/abc-123"');
    expect(html).toContain('window.location.href = "estia-clean-connect://invite/abc-123"');
    expect(html).toContain('installe l\'application');
  });

  it('échappe le jeton dans le script, qui est injecté en JSON', () => {
    const html = renderInvitePage('a"b');
    // JSON.stringify protège le script : la guillemet est échappée.
    expect(html).toContain('"estia-clean-connect://invite/a\\"b"');
  });
});

describe('page de réinitialisation du mot de passe', () => {
  it('embarque le jeton, poste vers l’API et redirige vers le dashboard', () => {
    const html = renderResetPasswordPage('jeton-xyz');
    expect(html).toContain('var token = "jeton-xyz"');
    // L'URL de l'API est injectée en JSON, puis concaténée au chemin dans le script.
    expect(html).toContain(`fetch(${JSON.stringify(process.env.APP_URL)} + '/auth/reset-password'`);
    expect(html).toContain('/login?reset=1');
    // La politique (12 caractères) est rappelée et vérifiée côté page.
    expect(html).toContain('minlength="12"');
    expect(html).toContain('p1.length < 12');
  });
});

describe('pages légales', () => {
  it('la politique de confidentialité nomme le responsable, les droits et la suppression de compte', () => {
    const html = renderPrivacyPage();
    expect(html).toContain('EC CONCIERGERIE');
    expect(html).toContain('RGPD');
    expect(html).toContain('Suppression de votre compte');
    expect(html).toContain('mailto:contact@estiaconciergerie.fr');
  });

  it('la page de support renvoie vers la politique de confidentialité', () => {
    const html = renderSupportPage();
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('mailto:contact@estiaconciergerie.fr');
  });
});
