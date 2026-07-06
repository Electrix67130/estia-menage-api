import env from '@/config/env';

/**
 * Pages web publiques servant de "pont" depuis les emails vers l'app mobile.
 * Un email ne peut pas ouvrir directement un deep link de maniere fiable :
 * on passe donc par une page HTTPS (toujours ouvrable dans un navigateur) qui
 * tente le deep link `estia-clean-connect://...` et propose une retombee manuelle.
 */

const BRAND = '#2563EB';

function logoUrl(): string {
  // `?v=2` = cache-bust : les clients mail (Gmail proxy) cachent l'image par URL.
  return `${env.APP_URL}/assets/logo-estia.png?v=3`;
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
  // Formulaire web autonome : fonctionne partout (mobile ET desktop/dashboard),
  // sans dépendre de l'app installée. POST direct vers /auth/reset-password.
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Réinitialisation du mot de passe — Estia Clean Connect</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7FAFC; color: #0F172A; }
    .wrap { max-width: 460px; margin: 0 auto; padding: 48px 24px; text-align: center; }
    img.logo { height: 88px; width: auto; margin-bottom: 24px; }
    .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px 24px; text-align: left; }
    h1 { font-size: 22px; margin: 0 0 8px; color: #0F172A; text-align: center; }
    p.intro { color: #475569; line-height: 1.6; font-size: 15px; margin: 0 0 20px; text-align: center; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin: 14px 0 6px; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 10px; font-size: 16px; background: #F8FAFC; }
    .pw { position: relative; }
    .pw input { padding-right: 46px; }
    .eye { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: auto; margin: 0; padding: 8px; background: none; border: 0; color: #64748B; cursor: pointer; display: flex; }
    button { width: 100%; margin-top: 20px; background: ${BRAND}; color: #FFF; border: 0; padding: 14px; border-radius: 10px; font-weight: 600; font-size: 16px; cursor: pointer; }
    button:disabled { opacity: .6; }
    .msg { margin-top: 16px; font-size: 14px; text-align: center; }
    .err { color: #E11D48; }
    .ok { color: #059669; }
    .muted { color: #94A3B8; font-size: 13px; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="${logoUrl()}" alt="Estia Clean Connect">
    <div class="card">
      <h1>Réinitialiser votre mot de passe</h1>
      <p class="intro">Choisissez un nouveau mot de passe (12 caractères minimum).</p>
      <form id="f">
        <label for="p1">Nouveau mot de passe</label>
        <div class="pw">
          <input id="p1" type="password" autocomplete="new-password" required minlength="12">
          <button type="button" class="eye" data-t="p1" aria-label="Afficher le mot de passe"></button>
        </div>
        <label for="p2">Confirmer le mot de passe</label>
        <div class="pw">
          <input id="p2" type="password" autocomplete="new-password" required minlength="12">
          <button type="button" class="eye" data-t="p2" aria-label="Afficher le mot de passe"></button>
        </div>
        <button id="b" type="submit">Réinitialiser</button>
      </form>
      <div id="m" class="msg"></div>
    </div>
    <p class="muted">Estia Clean Connect — Gestion de prestations de ménage</p>
  </div>
  <script>
    var token = ${JSON.stringify(token)};
    var dashLogin = ${JSON.stringify(`${env.DASHBOARD_URL}/login?reset=1`)};
    var f = document.getElementById('f'), m = document.getElementById('m'), b = document.getElementById('b');
    // Œil afficher/masquer sur les champs mot de passe.
    var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
    Array.prototype.forEach.call(document.querySelectorAll('.eye'), function (btn) {
      btn.innerHTML = EYE;
      btn.addEventListener('click', function () {
        var inp = document.getElementById(btn.getAttribute('data-t'));
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.innerHTML = show ? EYE_OFF : EYE;
      });
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
      m.className = 'msg';
      if (p1.length < 12) { m.className = 'msg err'; m.textContent = 'Le mot de passe doit faire au moins 12 caractères.'; return; }
      if (p1 !== p2) { m.className = 'msg err'; m.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      b.disabled = true; b.textContent = 'Réinitialisation…';
      fetch(${JSON.stringify(env.APP_URL)} + '/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, new_password: p1 })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok) {
            f.style.display = 'none';
            m.className = 'msg ok';
            m.textContent = 'Mot de passe modifié ! Redirection vers la connexion…';
            setTimeout(function () { window.location.href = dashLogin; }, 1400);
          } else {
            b.disabled = false; b.textContent = 'Réinitialiser';
            m.className = 'msg err';
            m.textContent = (res.d && res.d.message) || 'Lien invalide ou expiré. Refaites une demande de réinitialisation.';
          }
        }).catch(function () {
          b.disabled = false; b.textContent = 'Réinitialiser';
          m.className = 'msg err'; m.textContent = 'Erreur réseau. Réessayez.';
        });
    });
  </script>
</body>
</html>`;
}

const CONTACT_EMAIL = 'contact@estiaconciergerie.fr';
const CONTROLLER = 'EC CONCIERGERIE';
const LAST_UPDATED = '23 juin 2026';

/**
 * Page legale autonome (politique de confidentialite, support). Reutilise
 * l'identite visuelle Estia mais avec une mise en page "document" (texte long,
 * aligne a gauche) plutot que la carte centree des pages-pont.
 */
function legalShell(opts: { title: string; heading: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7FAFC; color: #0F172A; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
    .head { text-align: center; margin-bottom: 32px; }
    img.logo { height: 72px; width: auto; margin-bottom: 16px; }
    .card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px 28px; }
    h1 { font-size: 26px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; color: ${BRAND}; }
    p, li { color: #334155; line-height: 1.65; font-size: 15px; }
    ul { padding-left: 22px; }
    a { color: ${BRAND}; }
    .updated { color: #94A3B8; font-size: 13px; margin: 0 0 8px; }
    .muted { color: #94A3B8; font-size: 13px; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <img class="logo" src="${logoUrl()}" alt="Estia Clean Connect">
    </div>
    <div class="card">
      <h1>${opts.heading}</h1>
      <p class="updated">Derniere mise a jour : ${LAST_UPDATED}</p>
      ${opts.bodyHtml}
    </div>
    <p class="muted">Estia Clean Connect — ${CONTROLLER}</p>
  </div>
</body>
</html>`;
}

export function renderPrivacyPage(): string {
  return legalShell({
    title: 'Politique de confidentialite — Estia Clean Connect',
    heading: 'Politique de confidentialite',
    bodyHtml: `
      <p>La presente politique decrit comment <strong>${CONTROLLER}</strong> (le « responsable de traitement ») collecte et traite vos donnees personnelles dans le cadre de l'application <strong>Estia Clean Connect</strong>, conformement au Reglement General sur la Protection des Donnees (RGPD).</p>

      <h2>1. Donnees que nous collectons</h2>
      <ul>
        <li><strong>Donnees de compte</strong> : adresse email, prenom, nom, numero de telephone, photo de profil, nom de societe, et pour les prestataires : numero SIRET, numero de TVA et adresse de facturation. Votre mot de passe est stocke uniquement sous forme chiffree (hache).</li>
        <li><strong>Photos de prestation</strong> : photos prises ou importees lors des menages, horodatees et associees a leur position geographique (latitude/longitude) afin d'attester la realisation de la prestation.</li>
        <li><strong>Donnees des logements</strong> : adresses et coordonnees GPS des biens a entretenir, saisies par votre organisation.</li>
        <li><strong>Donnees techniques</strong> : jeton de notification push et type d'appareil (iOS/Android), pour vous envoyer des notifications liees a vos prestations.</li>
      </ul>
      <p>Nous n'utilisons <strong>aucun</strong> outil de publicite ni de pistage tiers.</p>

      <h2>2. Pourquoi nous utilisons ces donnees</h2>
      <ul>
        <li>Creer et gerer votre compte et vos droits d'acces.</li>
        <li>Organiser, planifier et attester les prestations de menage.</li>
        <li>Vous envoyer des notifications operationnelles (prestation disponible, assignee, modifiee, rappels).</li>
        <li>Gerer la facturation des prestations.</li>
      </ul>
      <p>La base legale est l'execution du contrat de service et notre interet legitime a assurer le bon fonctionnement du service.</p>

      <h2>3. Acces a la camera, aux photos et a la localisation</h2>
      <p>L'application demande l'acces a la camera et a la photothèque pour ajouter des photos aux prestations, et a votre position pour localiser les logements et geolocaliser les photos. Ces autorisations ne sont utilisees que pour ces finalites et peuvent etre revoquees a tout moment dans les reglages de votre appareil.</p>

      <h2>4. Partage des donnees</h2>
      <p>Vos donnees sont accessibles aux membres autorises de votre organisation selon leurs droits. Nous faisons appel a des sous-traitants techniques pour l'hebergement et l'envoi des notifications (service de notifications push Expo). Nous ne vendons jamais vos donnees.</p>

      <h2>5. Conservation</h2>
      <p>Vos donnees sont conservees pendant la duree de votre utilisation du service, puis archivees ou supprimees conformement a nos obligations legales (notamment comptables pour les donnees de facturation).</p>

      <h2>6. Vos droits</h2>
      <p>Vous disposez d'un droit d'acces, de rectification, d'effacement, de limitation et de portabilite de vos donnees, ainsi que du droit de retirer votre consentement. Pour exercer ces droits, contactez-nous a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Vous pouvez egalement introduire une reclamation aupres de la CNIL.</p>

      <h2>7. Suppression de votre compte</h2>
      <p>Vous pouvez demander la suppression de votre compte et des donnees associees a tout moment en ecrivant a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

      <h2>8. Contact</h2>
      <p>${CONTROLLER} — <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
    `,
  });
}

export function renderSupportPage(): string {
  return legalShell({
    title: 'Support — Estia Clean Connect',
    heading: 'Support & assistance',
    bodyHtml: `
      <p>Besoin d'aide avec l'application <strong>Estia Clean Connect</strong> ? Notre equipe est la pour vous accompagner.</p>
      <h2>Nous contacter</h2>
      <p>Pour toute question, signalement de bug ou demande relative a votre compte, ecrivez-nous a :</p>
      <p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
      <p>Nous nous efforcons de repondre sous 48 heures ouvrees.</p>
      <h2>Confidentialite</h2>
      <p>Consultez notre <a href="/privacy">politique de confidentialite</a> pour savoir comment vos donnees sont traitees.</p>
    `,
  });
}
