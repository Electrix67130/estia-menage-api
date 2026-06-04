# Plan de déploiement — Estia Ménage (phase pilote)

> Objectif : déployer en production **API + Dashboard + Mobile iOS/Android** pour un seul client (Estia), sans le site vitrine dans un premier temps.

---

## 1. Pré-requis (15 min)

Création des comptes nécessaires :

| Compte | URL | Coût |
|---|---|---|
| **Scaleway** (VPS + Object Storage + TEM email) | scaleway.com | 0 € au signup, puis usage |
| **Cloudflare** (DNS uniquement) | cloudflare.com | Free |
| **Apple Developer** | developer.apple.com | **99 USD/an (~93 €)** payé au signup |
| **Google Play Console** | play.google.com/console | **25 USD one-shot (~24 €)** |
| **Sentry** (errors) | sentry.io | Free tier |
| **Domaine** estia-menage.fr | OVH / Cloudflare Registrar | **~12 €/an** |

**Sous-total fixe immédiat** : ~130 €

---

## 2. Domaine + DNS (30 min)

```
1. Acheter estia-menage.fr (OVH 8€/an, Cloudflare Registrar 10€/an).
2. Transférer la zone DNS sur Cloudflare (gratuit, plus rapide qu'OVH).
3. Créer 2 records A (à pointer vers l'IPv4 du VPS Scaleway après déploiement) :
   - api.estia-menage.fr  A  <IP_VPS>
   - app.estia-menage.fr  A  <IP_VPS>
4. Apex (estia-menage.fr) : laissé non-routé pour l'instant.
```

**Coût** : 12 €/an

---

## 3. VPS + Base de données (3-4h)

**Scaleway Instance PLAY2-MICRO** — Paris (FR-PAR-1)

- 2 vCPU AMD, 4 GB RAM, 40 GB NVMe, 200 Mbps illimité
- **8,99 €/mois HT** + 1 € IPv4 publique = **~10 €/mois HT**

### 3.1 Provisionning du VPS

```
1. Console Scaleway → Instances → Create instance.
2. Région : Paris 1 (FR-PAR-1).
3. Type : PLAY2-MICRO.
4. Image : Ubuntu 24.04 LTS Noble.
5. Volume : 40 GB SSD (inclus).
6. SSH Key : ajouter ta clé publique ~/.ssh/id_ed25519.pub
   (sinon en générer une : ssh-keygen -t ed25519 -C "estia-prod").
7. Name : estia-menage-prod
8. Create.
```

Une IPv4 publique est attribuée. Pointer le DNS Cloudflare :
```
api.estia-menage.fr   A   <IP_publique_scaleway>   Proxied=OFF
```

### 3.2 Hardening initial

```bash
# Connexion en root
ssh root@<IP>

# Créer un utilisateur dédié
adduser estia
usermod -aG sudo estia
mkdir -p /home/estia/.ssh
cp ~/.ssh/authorized_keys /home/estia/.ssh/
chown -R estia:estia /home/estia/.ssh
chmod 700 /home/estia/.ssh
chmod 600 /home/estia/.ssh/authorized_keys

# Désactiver login root + password
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall : autoriser uniquement SSH, HTTP, HTTPS
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Mises à jour de sécurité automatiques
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Fail2ban (bonus anti-brute-force SSH)
apt install -y fail2ban
systemctl enable --now fail2ban
```

### 3.3 Docker + Docker Compose

On déploie l'API et Postgres en conteneurs via `docker-compose.prod.yml` (déjà
dans le repo). Pas d'install Node ni de Postgres natifs : le conteneur API
embarque Node 24 et tourne l'app via `tsx` (pas de build, les alias `@/` sont
résolus par tsconfig), et Postgres tourne dans son propre conteneur.

```bash
# Installer Docker Engine + plugin compose (méthode officielle)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker estia   # estia peut lancer docker sans sudo
sudo apt install -y git
```

> ⚠️ Se déconnecter / reconnecter en `estia` après le `usermod` pour que
> l'appartenance au groupe `docker` prenne effet.

### 3.4 Déploiement de l'API (Docker Compose)

```bash
# Cloner le repo
git clone https://github.com/Electrix67130/estia-menage-api.git /home/estia/api
cd /home/estia/api

# Fichier .env de prod : partir du template fourni
cp .env.production.example .env
nano .env   # remplir <MOT_DE_PASSE_FORT>, JWT_SECRET (openssl rand -hex 64),
            # API_KEY, SMTP_*, S3_* (cf. sections 7 et 8)
chmod 600 .env

# Build des images
docker compose -f docker-compose.prod.yml build

# Lancer les migrations (one-shot, contre le conteneur Postgres)
docker compose -f docker-compose.prod.yml run --rm api npm run migrate
docker compose -f docker-compose.prod.yml run --rm api npm run seed  # si seed prod prête

# Démarrer la stack (API + Postgres) en arrière-plan
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api   # vérifier le démarrage
```

> Les conteneurs ont `restart: unless-stopped` → ils redémarrent automatiquement
> au reboot du VPS. Pas besoin de systemd. L'API n'est publiée que sur
> `127.0.0.1:3000` (Caddy fait le reverse proxy HTTPS, cf. 3.6) et Postgres
> n'est jamais exposé hors du VPS.

### 3.6 Caddy en reverse proxy (HTTPS auto)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
api.estia-menage.fr {
    reverse_proxy localhost:3000
    encode gzip zstd
}
EOF

sudo systemctl reload caddy
```

→ Let's Encrypt est obtenu automatiquement par Caddy. Vérifie :
`curl https://api.estia-menage.fr/health`

### 3.7 Backups quotidiens vers Object Storage

```bash
sudo apt install -y awscli

# Config AWS CLI pour Scaleway
sudo -u estia aws configure set aws_access_key_id <SCW_ACCESS_KEY>
sudo -u estia aws configure set aws_secret_access_key <SCW_SECRET_KEY>
sudo -u estia aws configure set default.region fr-par

# Script de backup
sudo tee /home/estia/backup.sh >/dev/null <<'EOF'
#!/bin/bash
set -e
DATE=$(date +%Y%m%d_%H%M%S)
DUMP=/tmp/estia_$DATE.sql.gz
# pg_dump exécuté DANS le conteneur Postgres (pas d'install pg native sur l'hôte)
docker compose -f /home/estia/api/docker-compose.prod.yml exec -T db \
  pg_dump -U estia estia_menage | gzip > $DUMP
aws s3 cp $DUMP s3://estia-menage-backups/postgres/ --endpoint-url https://s3.fr-par.scw.cloud
rm $DUMP
# Rétention : on garde 30 jours
aws s3 ls s3://estia-menage-backups/postgres/ --endpoint-url https://s3.fr-par.scw.cloud \
  | awk '{print $4}' | head -n -30 \
  | xargs -I {} aws s3 rm s3://estia-menage-backups/postgres/{} --endpoint-url https://s3.fr-par.scw.cloud
EOF
chmod +x /home/estia/backup.sh
chown estia:estia /home/estia/backup.sh

# Cron quotidien à 03h00
(sudo -u estia crontab -l 2>/dev/null; echo "0 3 * * * /home/estia/backup.sh >> /home/estia/backup.log 2>&1") | sudo -u estia crontab -
```

### 3.8 Déploiement continu (optionnel mais pratique)

Sur le VPS, créer un endpoint webhook ou utiliser un simple cron `git pull` :

```bash
# Méthode simple : webhook GitHub → SSH pull + rebuild Docker
sudo -u estia tee /home/estia/deploy.sh >/dev/null <<'EOF'
#!/bin/bash
set -e
cd /home/estia/api
git pull origin master
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npm run migrate
docker compose -f docker-compose.prod.yml up -d
docker image prune -f
EOF
chmod +x /home/estia/deploy.sh
```

Ou plus propre : utiliser **GitHub Actions** avec un workflow `deploy.yml` qui se connecte en SSH et lance `deploy.sh`. À configurer plus tard.

**Coût Scaleway** : ~10 €/mois (~120 €/an) — incluant l'IPv4.

---

## 4. Dashboard self-hosted sur le VPS (45 min)

Le dashboard Next.js tourne sur le même VPS Scaleway, à côté de l'API.

### 4.1 Build + déploiement

```bash
# Sur le VPS, en tant que estia
sudo -u estia git clone https://github.com/Electrix67130/estia-menage-dashboard.git /home/estia/dashboard
cd /home/estia/dashboard
sudo -u estia npm ci

# .env.production — NEXT_PUBLIC_API_KEY doit valoir EXACTEMENT la même valeur
# que API_KEY dans le .env de l'API (le dashboard l'envoie en en-tête x-api-key ;
# sans elle, tous les appels API repartent en 401).
sudo -u estia tee /home/estia/dashboard/.env.production >/dev/null <<EOF
NEXT_PUBLIC_API_URL=https://api.estia-menage.fr
NEXT_PUBLIC_API_KEY=<MEME_VALEUR_QUE_API_KEY_DE_L_API>
EOF

# Build Next.js (mode standalone pour minimiser la taille)
sudo -u estia npm run build
```

### 4.2 Service systemd

```bash
sudo tee /etc/systemd/system/estia-dashboard.service >/dev/null <<'EOF'
[Unit]
Description=Estia Menage Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=estia
WorkingDirectory=/home/estia/dashboard
EnvironmentFile=/home/estia/dashboard/.env.production
Environment=NODE_ENV=production
Environment=PORT=3001
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now estia-dashboard
sudo systemctl status estia-dashboard
```

### 4.3 Ajouter le bloc Caddy

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
api.estia-menage.fr {
    reverse_proxy localhost:3000
    encode gzip zstd
}

app.estia-menage.fr {
    reverse_proxy localhost:3001
    encode gzip zstd
}
EOF

sudo systemctl reload caddy
```

→ Vérifie : `curl -I https://app.estia-menage.fr` (devrait répondre 200).

### 4.4 Étendre `deploy.sh` pour redéployer le dashboard aussi

```bash
sudo -u estia tee /home/estia/deploy.sh >/dev/null <<'EOF'
#!/bin/bash
set -e

# API (conteneurisée — cf. §3.4)
cd /home/estia/api
git pull origin master
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npm run migrate
docker compose -f docker-compose.prod.yml up -d
docker image prune -f

# Dashboard (Next.js natif + systemd — cf. §4.2)
cd /home/estia/dashboard
git pull origin master
npm ci
npm run build
sudo systemctl restart estia-dashboard
EOF
chmod +x /home/estia/deploy.sh
```

**Coût** : 0 € (utilise les ressources du VPS déjà payé)

---

## 5. Mobile iOS (3h setup initial)

**Apple Developer + EAS Build (free tier)**

```
1. Acheter Apple Developer Program (99 USD/an) — comptez 48h pour activation.
2. Dans App Store Connect, créer l'app "Estia Ménage"
   (bundle id: com.electrix.estiamenage).
3. Côté Expo :
   - npx eas-cli login
   - eas init   (lie le repo à EAS)
   - eas credentials (configure les certificats iOS — EAS les gère pour toi)
4. Build TestFlight :
   - eas build --platform ios --profile preview
   - Une fois compilé, upload auto vers App Store Connect.
5. Dans App Store Connect → TestFlight → ajouter les emails Estia comme
   testeurs internes. Les testeurs reçoivent un lien d'invitation, installent
   l'app TestFlight, puis Estia Ménage.
```

**EAS free tier** : 30 builds/mois suffisent pour un pilote.
**Coût Apple Dev** : 99 USD/an (~93 €)

---

## 6. Mobile Android (1h)

**Google Play + EAS**

```
1. Créer un compte Play Console (25 USD one-shot).
2. Créer une app "Estia Ménage" en mode "Internal Testing".
3. EAS Android :
   - eas build --platform android --profile preview
   - Upload manuel du .aab dans Play Console > Internal Testing.
4. Ajouter les emails Estia dans Internal Testing → ils reçoivent un lien
   direct pour installer depuis le Play Store, limité aux testeurs autorisés.
```

**Coût** : 25 USD one-shot (~24 €)

---

## 7. Stockage photos + backups — Scaleway Object Storage (15 min)

**Scaleway Object Storage** (S3-compatible, datacenter Paris)

```
1. Console Scaleway → Object Storage → Create bucket.
2. Créer 2 buckets en région FR-PAR :
   - estia-menage-photos    (visibilité : private, accessibles via API)
   - estia-menage-backups   (visibilité : private)
3. Console Scaleway → IAM → API Keys → Generate new API key
   avec les permissions "Object Storage Full Access".
4. Récupérer :
   - SCW_ACCESS_KEY
   - SCW_SECRET_KEY
5. Côté API .env (déjà dans la section VPS) — noms exacts attendus par le code :
   - STORAGE_MODE = s3
   - S3_ENDPOINT = https://s3.fr-par.scw.cloud
   - S3_REGION = fr-par
   - S3_BUCKET = estia-menage-photos
   - S3_ACCESS_KEY = <SCW_ACCESS_KEY>
   - S3_SECRET_KEY = <SCW_SECRET_KEY>
6. Optionnel : custom domain "photos.estia-menage.fr" (CNAME vers le bucket).
```

**Coût** :
- **75 GB inclus gratuitement** (stockage + égress)
- Au-delà : 0,012 €/GB/mois stockage, 0,01 €/GB égress
- Pour 5 000 photos compressées (~10 GB) + 30 jours de dumps Postgres (~1 GB) → reste 100 % gratuit.

---

## 8. Email transactionnel — Scaleway TEM (20 min)

**Scaleway Transactional Email Manager** (SMTP + API HTTP)

```
1. Console Scaleway → Transactional Email → Activate.
2. Ajouter le domaine estia-menage.fr → Scaleway donne :
   - 1 record SPF (TXT)
   - 1 record DKIM (TXT)
   - 1 record MX (optionnel, pour recevoir les bounces)
3. Ajouter ces records dans Cloudflare DNS, attendre la validation
   (quelques minutes à quelques heures).
4. Console → Transactional Email → SMTP Credentials → Generate.
   Récupérer :
   - SMTP_HOST = smtp.tem.scw.cloud
   - SMTP_PORT = 587 (STARTTLS) ou 2465 (TLS)
   - SMTP_USERNAME = <project_id>
   - SMTP_PASSWORD = <api_secret>
5. Côté API .env (sur le VPS) :
   - SMTP_HOST=smtp.tem.scw.cloud
   - SMTP_PORT=587
   - SMTP_USER=<project_id>
   - SMTP_PASSWORD=<api_secret>
   - EMAIL_FROM="Estia Ménage <noreply@estia-menage.fr>"
6. Tester l'envoi depuis l'API (invitation, reset password…).
```

**Coût** :
- **300 emails/jour gratuits** (~9 000/mois)
- Au-delà : **0,25 € / 1 000 emails**
- Pour le pilote Estia : largement dans le free tier.

---

## 9. Monitoring (15 min)

**Sentry** (errors + perfs)

```
1. Sentry → New project (Node.js pour API, Next.js pour dashboard,
   React Native pour mobile).
2. Coller le DSN dans chaque .env (SENTRY_DSN).
3. ⚠️ **À FAIRE** : Sentry n'est pas encore intégré côté API. Il faut installer
   `@sentry/node`, l'initialiser au boot (`src/server.ts`) et ajouter `SENTRY_DSN`
   au schéma d'env (`src/config/env.ts`). Tant que ce n'est pas fait, le monitoring
   d'erreurs applicatives n'est pas actif — l'uptime (UptimeRobot) reste possible.
```

**Coût** : free tier 5 000 events/mois.

---

## 10. CI/CD GitHub Actions (1h)

- **API** : déploiement via SSH depuis GitHub Actions (cf. §3.8).
  Workflow `deploy-api.yml` qui SSH sur le VPS et lance `/home/estia/deploy.sh` sur push master.
  Secrets GitHub à configurer : `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`.
- **Dashboard** : Vercel auto-deploy depuis push master → rien à configurer.
- **Mobile** : optionnel, EAS auto-builds via `eas-cli` quand on tag une version.
  Pour la phase pilote, builds manuels suffisent
  (`eas build --platform all --profile preview`).

---

## Récap coûts

### Phase testing (pilote Estia uniquement)

> Single-tenant, ~50-200 ménages/mois, photos < 10 GB, trafic faible.
> Stack : 100 % Scaleway (VPS + Object Storage + TEM email).

**Coûts récurrents annuels :**

| Poste | Coût HT/an |
|---|---|
| Domaine estia-menage.fr | 12 € |
| Apple Developer | 93 € |
| Scaleway VPS PLAY2-MICRO + IPv4 (API + Dashboard + Postgres + Caddy) | ~120 € |
| Scaleway Object Storage (photos + backups) | 0 € (< 75 GB free) |
| Scaleway Transactional Email | 0 € (< 300/jour free) |
| Sentry (errors) | 0 € (< 5k events/mois) |
| **TOTAL récurrent** | **~225 € HT/an** (~270 € TTC) |

**Coûts one-shot (Année 1 uniquement) :**

| Poste | Coût HT |
|---|---|
| Google Play | 24 € |

**Total Année 1 phase testing : ~250 € HT (~300 € TTC)**
**Total Année 2+ phase testing : ~225 € HT/an (~270 € TTC/an)**

→ Soit environ **22 €/mois TTC** en régime de croisière.

---

### Phase production réelle (multi-clients, ouverture publique)

> Plusieurs conciergeries, ~1 000-5 000 ménages/mois, photos > 100 GB, trafic dashboard significatif, besoin de HA et de backups managés.
> Stack : 100 % Scaleway, on sépare l'app de la DB et on upgrade les instances.

**Coûts récurrents annuels :**

| Poste | Coût HT/an | Détail |
|---|---|---|
| Domaine estia-menage.fr | 12 € | identique |
| Apple Developer | 93 € | identique |
| Scaleway VPS PRO2-XS (API + Dashboard) | ~300 € | 4 vCPU, 16 GB — ~25 €/mois |
| Scaleway Postgres managé (DB-DEV-XS) | ~180 € | 2 vCPU, 4 GB, backups auto, HA opt. — ~15 €/mois |
| Scaleway Object Storage (~300 GB) | ~30 € | au-delà du free tier |
| Scaleway Transactional Email (~30k/mois) | ~65 € | 0,25 €/1000 emails |
| Sentry Team | ~290 € | 26 $/mois (50k events/mois) |
| UptimeRobot Pro | ~70 € | 7 $/mois (monitoring + statuspage) |
| **TOTAL récurrent** | **~1 040 € HT/an** (~1 250 € TTC) |

→ Soit environ **85-105 €/mois TTC** en production.

**Note** : les chiffres ci-dessus sont une **estimation prudente**. En réalité, certains services peuvent rester en free tier plus longtemps (Sentry jusqu'à 5k events/mois, TEM jusqu'à 9k mails/mois) — possible d'économiser ~400 €/an au démarrage de la prod publique en n'upgrade que quand on dépasse.

**Estimation minimale prod publique (free tiers conservés)** : ~650 € HT/an (~780 € TTC).
**Estimation confortable prod publique (tous les Pro)** : ~1 040 € HT/an (~1 250 € TTC).

---

### Comparaison rapide

| Phase | Mensuel TTC | Annuel TTC |
|---|---|---|
| Pilote testing (Estia seul) | **~22 €** | **~270 €** |
| Prod publique minimale | **~65 €** | **~780 €** |
| Prod publique confortable | **~105 €** | **~1 250 €** |

---

## Temps de setup total

- **Domaine + DNS Cloudflare** : 30 min
- **Scaleway VPS + Docker (API + Postgres conteneurisés) + Caddy** : 2-3h
- **Self-host dashboard Next.js (build + systemd + Caddy)** : 45 min
- **Scaleway Object Storage (photos + backups)** : 15 min
- **Backups cron vers Object Storage** : 30 min
- **Scaleway Transactional Email** : 20 min
- **Sentry** : 15 min
- **Apple Developer (en attente activation)** : 2h setup + 48h attente
- **EAS iOS first build + TestFlight** : 1h30
- **Google Play + EAS Android** : 1h

**Total actif** : ~10h sur 2-3 jours calendaires (le délai Apple est le frein principal).

---

## Ordre d'exécution recommandé

1. **J0** : Acheter domaine + Apple Developer + Google Play
   (lancer l'activation Apple en premier, c'est le plus long).
2. **J0** : Setup Cloudflare DNS + Sentry pendant l'attente Apple.
3. **J0** : Provisionner Scaleway VPS + Object Storage + TEM (sections 3 + 7 + 8).
4. **J0** : Déployer l'API + le dashboard self-hosted sur le VPS (sections 3 + 4).
5. **J0** : Inviter Estia sur le dashboard, créer leurs comptes admin.
6. **J+2** (activation Apple OK) : EAS build iOS + Android, invitations
   TestFlight et Play Internal Testing.
7. **J+2** : Estia installe les apps sur leurs téléphones et utilise.

---

## Points de vigilance

- **Sauvegardes Postgres** : le cron `/home/estia/backup.sh` dump toutes les nuits
  vers le bucket `estia-menage-backups` avec rétention 30 jours. **À tester**
  une fois pour vérifier qu'un `gunzip | psql` restaure correctement.
- **Secrets** : ne jamais committer les `.env` (déjà gitignored). Sur le VPS,
  `/home/estia/api/.env` et `/home/estia/dashboard/.env.production` doivent être en
  `chmod 600` propriétaire `estia`.
- **HTTPS** : Caddy gère Let's Encrypt automatiquement pour les 2 sous-domaines.
  Vérifier le renouvellement via
  `journalctl -u caddy --since "1 week ago" | grep -i renew`.
- **Mises à jour OS** : `unattended-upgrades` installé en §3.2 → patch de sécurité
  appliqués automatiquement.
- **Monitoring** : Sentry pour les erreurs applicatives. Pour l'uptime, ajouter
  **UptimeRobot** (free, 50 monitors) qui ping `https://api.estia-menage.fr/health`
  et `https://app.estia-menage.fr/` toutes les 5 min.
- **RGPD** : prévoir une mention dans l'app + une page "politique de
  confidentialité" hébergée quelque part (peut être une route statique du
  dashboard). **Non** obligatoire pour TestFlight et Play Internal Testing,
  **oui** pour ouverture publique.
- **Argument commercial** : **stack 100 % Scaleway, hébergée en France** (Paris) →
  conformité RGPD native, à mettre en avant auprès d'Estia et futurs clients.
- **Single point of failure** : tout sur 1 seul VPS. Pour la phase pilote c'est OK.
  Pour la prod publique, séparer (cf. §"Migration").
- **Migration vers production publique** : prévoir
  - VPS app upgrade PLAY2-MICRO → PRO2-XS (~25 €/mois) si charge augmente.
  - DB managée Scaleway Postgres (~15 €/mois) pour HA + backups automatiques
    intégrés, le jour où on ne veut plus gérer Postgres sur le VPS.
  - Séparer API et dashboard sur 2 VPS différents (load isolation).
  - App Store / Play Store review (~1-3 jours).
