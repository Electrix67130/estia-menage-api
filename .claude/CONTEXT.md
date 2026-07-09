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
| **API** | `estia-menage-api` | Fastify + Knex (PostgreSQL) + Zod + TS | tag git `[0-9]*` → CI SSH → VPS (docker build + `npm run migrate`) | dernier tag **0.1.54** · `api.estia-clean-connect.fr` |
| **Dashboard** (admin web) | `estia-menage-dashboard` | Next.js (App Router) | tag git `[0-9]*` → CI SSH → VPS | dernier tag **0.1.67** |
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
- **Checklist** par logement (modèles réutilisables). Chaque section a une **icône emoji** optionnelle (palette + « aucune ») choisie dans l'éditeur de template (mobile + dashboard), reportée sur la checklist générée.
- **Création manuelle** d'une prestation (mobile, FAB admin) : sélecteur de type ; formulaire adapté (check-in/out = heure unique, pas de durée/linge).
- **Filtre « Non assigné »** dans le filtre prestataire (mobile + dashboard) pour lister les prestations sans prestataire. Détail : tous les prestataires affectés (multi-presta) sont affichés.
- **Badges « non lus »** (commentaires / commentaires d'étape / photos ajoutés par un autre après ta dernière ouverture) : compteur par prestation (🔔 sur chaque ligne, dashboard + mobile) + badge de nav. Le badge est **ventilé par type** (`by_type` : le badge « Ménages » du dashboard ne compte que les ménages, Check-ins/Check-outs ont le leur ; mobile = onglet unifié). Ne compte **pas les prestations clôturées** (valide/annule → Archives), donc chaque badge = une ligne visible dans la liste active.
- **Photos + commentaires** par prestation ; **pointage** arrivée/départ ; **validation** du rapport par l'admin. La **déclaration voyageurs** (note 1-5 + dégradation) est saisie au pointage d'arrivée **et** ré-éditable après coup (`PUT /menages/:id/declaration`, presta assigné ou admin) — mobile + dashboard.
- **Demandes de report** (reschedule) presta → admin.
- **Notifications push** (Expo) + **emails brandés** ; **rappels programmés** (veille 18h, 2h avant).
- **Consommables** par logement + alertes sous seuil.
- **Facturation** (dashboard, admin) : factures/devis regroupant les ménages par client+période, PDF, export CSV, statuts, numérotation légale ; récap « à payer prestataires ».
- **Gains** (dashboard, admin) : par semaine/mois/année/tout → **CA client (HT)** · **à payer (coût presta)** · **marge** ; ventilation par client et par prestataire ; clic presta → détail de ses prestations ; bouton **« Facturer »** (deep-link vers création de facture pré-remplie).
- **Archivage logement en cascade** : archive le logement + toutes ses prestations + ses consommables (confirmation explicite).
- **Détail prestation (mobile)** : adresse du logement (tap → Maps) + galerie photos des pièces (vignette + visionneuse swipeable façon Photos iOS via `react-native-image-viewing`). Les photos de pièces = `/photos` liées à `logement_room_id` (ajoutées côté dashboard).
- **Profil mobile** : pied de page « version + provenance du bundle (build natif / OTA + date) » pour vérifier qu'une OTA est bien appliquée.
- **Cache offline (mobile, lecture seule)** : le cache React Query est persisté sur AsyncStorage (rétention 24 h, seules les requêtes réussies, `buster` de version dans `src/lib/persist.ts` à incrémenter pour purger après un breaking change de schéma). Réhydraté au démarrage → les prestations/checklists déjà consultées s'affichent hors connexion. Détection réseau 100 % JS (`src/lib/network.ts` : probe `fetch` + `AppState` sur `onlineManager`) → pause/reprise auto + `refetchOnReconnect`, **livrable en OTA** (pas de module natif). **Bandeau « Mode hors ligne »**. Les **mutations** sont en `networkMode: 'always'` → une action tentée hors ligne **échoue immédiatement** (pas de rejeu différé). Cache **purgé au logout**.

## Règles métier notables

- Tarifs d'un ménage modifiables par l'**admin** uniquement.
- Affecter un prestataire à un ménage = **admin** uniquement.
- Montants « gains/facturation » comptés sur ménages **terminés/validés**. CA = `client_price_ht` (+ blanchisserie client) ; coût = `provider_price` (+ blanchisserie presta).
- URLs internes `/files` signées à la lecture (token TTL court).
