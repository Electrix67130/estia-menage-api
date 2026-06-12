import env from '@/config/env';

/**
 * Pages web publiques servant de "pont" depuis les emails vers l'app mobile.
 * Un email ne peut pas ouvrir directement un deep link de maniere fiable :
 * on passe donc par une page HTTPS (toujours ouvrable dans un navigateur) qui
 * tente le deep link `estia-clean-connect://...` et propose une retombee manuelle.
 */

const BRAND = '#2563EB';

function logoUrl(): string {
  return `${env.APP_URL}/assets/logo-estia.png`;
}

function shell(opts: {
  title: string;
  heading: string;
  intro: string;
  deepLink: string;
  buttonLabel: string;
}): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7FAFC; color: #0F172A; }
    .wrap { max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center; }
    img.logo { height: 88px; width: auto; margin-bottom: 24px; }
    .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px 24px; }
    h1 { font-size: 22px; margin: 0 0 12px; color: #0F172A; }
    p { color: #475569; line-height: 1.6; font-size: 15px; margin: 0 0 8px; }
    .btn { display: inline-block; background: ${BRAND}; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; margin: 24px 0 4px; }
    .muted { color: #94A3B8; font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="${logoUrl()}" alt="Estia Clean Connect">
    <div class="card">
      <h1>${opts.heading}</h1>
      <p>${opts.intro}</p>
      <a class="btn" href="${opts.deepLink}">${opts.buttonLabel}</a>
      <p class="muted">Si rien ne se passe, installe l'application <strong>Estia Clean Connect</strong> sur ton telephone, puis rouvre ce lien.</p>
    </div>
    <p class="muted">Estia Clean Connect — Gestion de prestations de menage</p>
  </div>
  <script>
    setTimeout(function () { window.location.href = ${JSON.stringify(opts.deepLink)}; }, 500);
  </script>
</body>
</html>`;
}

export function renderInvitePage(token: string): string {
  return shell({
    title: 'Invitation — Estia Clean Connect',
    heading: 'Vous etes invite !',
    intro: "Ouvrez l'application Estia Clean Connect pour accepter votre invitation et rejoindre l'organisation.",
    deepLink: `estia-clean-connect://invite/${token}`,
    buttonLabel: "Ouvrir l'application",
  });
}

export function renderResetPasswordPage(token: string): string {
  return shell({
    title: 'Reinitialisation du mot de passe — Estia Clean Connect',
    heading: 'Reinitialiser votre mot de passe',
    intro: "Ouvrez l'application Estia Clean Connect pour choisir un nouveau mot de passe.",
    deepLink: `estia-clean-connect://reset-password/${token}`,
    buttonLabel: 'Choisir un nouveau mot de passe',
  });
}
