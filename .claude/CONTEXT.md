# Contexte produit — Estia Clean Connect

> Carte fonctionnelle de TOUT le produit (les 3 apps). Lue automatiquement à chaque session.
> **À mettre à jour à chaque modification fonctionnelle** (nouvelle feature, changement de flux, déploiement).
> Rester concis : c'est une vue d'ensemble, pas la doc détaillée (voir `docs/API.md`, `docs/MCD.md`).

## C'est quoi

Gestion de prestations de ménage pour conciergerie de locations courte durée (Airbnb…).
Une conciergerie (org) gère des **logements** et des **prestataires** ; chaque intervention datée = une **prestation** (ménage, check-in ou check-out).

## Les 3 apps (repos séparés)

| App | Repo | Stack | Déploiement | État |
|---|---|---|---|---|
| **API** | `estia-menage-api` | Fastify + Knex (PostgreSQL) + Zod + TS | tag git `[0-9]*` → CI SSH → VPS (docker build + `npm run migrate`) | dernier tag **0.1.42** · `api.estia-clean-connect.fr` |
| **Dashboard** (admin web) | `estia-menage-dashboard` | Next.js (App Router) | tag git `[0-9]*` → CI SSH → VPS | dernier tag **0.1.62** |
| **Mobile** (presta + admin) | `estia-menage-ui` | Expo SDK 54 + EAS | **OTA** `eas update --branch production --environment production` (JS) · build natif = TestFlight | runtime **0.1.0**, TestFlight **0.1.0 (19)** · bundle `fr.estiacleanconnect.app` |

> ⚠️ **OTA mobile — toujours `--environment production`.** Sans ce flag, `eas update` inline le `.env` **local** (`EXPO_PUBLIC_API_URL`/`_API_KEY` = localhost) dans le bundle prod → l'app pointe vers l'API locale et le login casse. Les vraies valeurs sont dans les variables d'env EAS (environment `production`).

**Parité** : toute feature doit être déclinée dashboard **et** mobile quand elle concerne les deux (sauf facturation/gains = dashboard-only).

## Rôles

- **admin** : accès total à son org (logements, prestations, prestataires, facturation, gains).
- **prestataire** : voit/pointe les prestations des logements auxquels il est affecté ; ne crée pas de logement.
- Accès fin par logement via `logement_member` (permissions : voir clients, etc.).

## Entités principales

`logement` (bien paramétrable : checklist, consommables, calendriers iCal, toggles check-in/out, code boîte à clés) · `menage` (= prestation datée ; `prestation_type` ∈ menage/check_in/check_out) · `menage_check_section`/`menage_check_item` (checklist auto-générée) · `logement_member` · `photo` · `comment` · `client` · `invoice`/`invoice_line` · `logement_consommable` · `menage_prestataire` (multi-affectation) · `logement_external_calendar` · reschedule requests · device tokens (push).

## Fonctionnalités clés

- **Prestations** ménage / check-in / check-out, avec **tag de type coloré** (Ménage=bleu, Check-in=vert, Check-out=rouge) partout : listes, détail, cards calendrier, dashboard.
- **Sync iCal** (Airbnb…) : chaque réservation génère un ménage + (si toggles `enable_check_in`/`enable_check_out` du logement) une prestation check-in/out. Dédup par `external_event_uid` + `prestation_type`.
- **Checklist** par logement (modèles réutilisables).
- **Photos + commentaires** par prestation ; **pointage** arrivée/départ ; **validation** du rapport par l'admin.
- **Demandes de report** (reschedule) presta → admin.
- **Notifications push** (Expo) + **emails brandés** ; **rappels programmés** (veille 18h, 2h avant).
- **Consommables** par logement + alertes sous seuil.
- **Facturation** (dashboard, admin) : factures/devis regroupant les ménages par client+période, PDF, export CSV, statuts, numérotation légale ; récap « à payer prestataires ».
- **Gains** (dashboard, admin) : par semaine/mois/année/tout → **CA client (HT)** · **à payer (coût presta)** · **marge** ; ventilation par client et par prestataire ; clic presta → détail de ses prestations ; bouton **« Facturer »** (deep-link vers création de facture pré-remplie).
- **Archivage logement en cascade** : archive le logement + toutes ses prestations + ses consommables (confirmation explicite).

## Règles métier notables

- Tarifs d'un ménage modifiables par l'**admin** uniquement.
- Affecter un prestataire à un ménage = **admin** uniquement.
- Montants « gains/facturation » comptés sur ménages **terminés/validés**. CA = `client_price_ht` (+ blanchisserie client) ; coût = `provider_price` (+ blanchisserie presta).
- URLs internes `/files` signées à la lecture (token TTL court).
