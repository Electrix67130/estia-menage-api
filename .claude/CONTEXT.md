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
| **API** | `estia-menage-api` | Fastify + Knex (PostgreSQL) + Zod + TS | tag git `[0-9]*` → CI SSH → VPS (docker build + `npm run migrate`) | dernier tag **0.1.58** · `api.estia-clean-connect.fr` |
| **Dashboard** (admin web) | `estia-menage-dashboard` | Next.js (App Router) | tag git `[0-9]*` → CI SSH → VPS | dernier tag **0.1.74** |
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
- **Sync iCal** (Airbnb…) : chaque réservation génère un ménage + (si toggles `enable_check_in`/`enable_check_out` du logement) une prestation check-in/out. Dédup par `external_event_uid` + `prestation_type`. **Retirer une presta auto** : la supprimer la marque `sync_ignored` + `annulé` (pas de hard delete, sinon la sync la recrée) → elle ne réapparaît plus au pull ; **« Remettre »** depuis le détail (dashboard : Historique → prestation ; mobile : écran **Historique** accessible via l'onglet Prestations, bouton « Remettre » sur les retirées — réservé à l'admin). **L'historique presta ne liste que les prestations qu'il a réellement faites** (affecté : référent OU co-presta), pas toutes celles des logements dont il est membre — via `GET /menages?assigned=me`. L'admin garde la vue complète. GC hard delete auto une fois **passée + disparue du feed**. Presta **manuelle** = hard delete définitif.
- **Checklist** par logement (modèles réutilisables). Chaque section a une **icône emoji** optionnelle (palette + « aucune ») choisie dans l'éditeur de template (mobile + dashboard), reportée sur la checklist générée.
- **Création manuelle** d'une prestation (mobile, FAB admin) : sélecteur de type ; formulaire adapté (check-in/out = heure unique, pas de durée/linge).
- **Filtre « Non assigné »** dans le filtre prestataire (mobile + dashboard) pour lister les prestations sans prestataire. Détail : tous les prestataires affectés (multi-presta) sont affichés, avec un badge **« Référent »** sur le principal. L'admin peut **désigner le référent** parmi les prestas affectés (bouton « Définir référent » sur les autres — dashboard + mobile) via `PUT /menages/:id/prestataires/:user_id/primary` (met à jour `is_primary` / `menage.prestataire_user_id` sans changer la liste).
- **Badges « non lus »** (commentaires / commentaires d'étape / photos ajoutés par un autre après ta dernière ouverture) : compteur par prestation (🔔 sur chaque ligne, dashboard + mobile) + badge de nav. Le badge est **ventilé par type** (`by_type` : le badge « Ménages » du dashboard ne compte que les ménages, Check-ins/Check-outs ont le leur ; mobile = onglet unifié). Ne compte **pas les prestations clôturées** (valide/annule → Archives), donc chaque badge = une ligne visible dans la liste active. **Périmètre presta** : un prestataire n'est notifié que pour les prestations où il est **affecté** (référent OU co-presta) — être simple membre `prestataire` d'un logement ne suffit pas (sinon une photo/un commentaire posé par un autre presta sur SA prestation créait un badge parasite). Seuls les membres de rôle **`manager`** (superviseurs) gardent les badges sur tout le logement ; l'admin voit tout. **Anti « badge fantôme » (dashboard)** : si un ménage avec du nouveau est masqué par les filtres actifs (statut/logement/presta/période/recherche), un bandeau le remonte en tête de liste avec lien direct + « Réinitialiser les filtres ». Les filtres de la liste étant **mémorisés** (persistés), une **barre « Filtres actifs : … · Réinitialiser »** s'affiche dès qu'un filtre est appliqué (**dashboard + mobile**). Le filtre **Créateur** range les prestations iCal sous « Airbnb », pas sous un admin.
- **Photos + commentaires** par prestation ; **pointage** arrivée/départ ; **validation** du rapport par l'admin — la modale de validation affiche un **récap du rapport** (note voyageurs + dégradations + photos du ménage) **dashboard ET mobile** (parité). La **déclaration voyageurs** (note 1-5 + dégradation) est saisie au pointage d'arrivée **et** ré-éditable après coup (`PUT /menages/:id/declaration`, presta assigné ou admin) — mobile + dashboard.
- **Calendrier** (dashboard + mobile, presta ET admin) : vue mois par défaut ; case/switch **« Vue semaine (durées) »** → timeline chronologique (grille d'heures, chaque prestation = bloc dont la hauteur = `duree_estimee_min`, chevauchements en couloirs, bande « sans heure », navigation semaine). Mobile : timeline scrollable horizontalement.
- **Filtres statut** (liste prestations, dashboard + mobile) : ordre **Tous · À venir · En cours · À valider** ; « Terminé » retiré (doublon de « À valider »).
- **Demandes de report** (reschedule) presta → admin.
- **Notifications push** (Expo) + **emails brandés** ; **rappels programmés** (veille 18h, 2h avant). **Destinataires d'une prestation** (`getMenageRecipientIds`, push + realtime) = créateur + admins de l'org + prestas **affectés** (référent + co-presta) + membres `manager`/`client_proprietaire`. Un membre de rôle `prestataire` **non affecté** n'est pas notifié (même règle que les badges non-lus).
- **Consommables** par logement + alertes sous seuil.
- **Facturation** (dashboard, admin) : factures/devis regroupant les ménages par client+période, PDF, export CSV, statuts, numérotation légale ; récap « à payer prestataires ».
- **Gains** (dashboard, admin) : par semaine/mois/année/tout → **CA client (HT)** · **à payer (coût presta)** · **marge** ; ventilation par client et par prestataire ; clic presta → détail de ses prestations ; bouton **« Facturer »** (deep-link vers création de facture pré-remplie).
- **Archivage logement en cascade** : archive le logement + toutes ses prestations + ses consommables (confirmation explicite). **Réversible** : `POST /logements/:id/unarchive` restaure en cascade inverse (uniquement ce qui a été archivé par la même cascade). Vue « logements archivés » (dashboard : case « Inclure les archivés » ; mobile : bouton « Archivés ») avec action **Restaurer** (admin), disponible **dans la liste ET dans le détail** du logement. `GET /logements?archived=true` liste les archivés.
- **Détail prestation (mobile)** : adresse du logement (tap → Maps) + galerie photos des pièces (vignette + visionneuse swipeable façon Photos iOS via `react-native-image-viewing`). Les photos de pièces = `/photos` liées à `logement_room_id` (ajoutées côté dashboard).
- **Profil mobile** : pied de page « version + provenance du bundle (build natif / OTA + date) » pour vérifier qu'une OTA est bien appliquée.
- **Cache offline (mobile, lecture seule)** : le cache React Query est persisté sur AsyncStorage (rétention 24 h, seules les requêtes réussies, `buster` de version dans `src/lib/persist.ts` à incrémenter pour purger après un breaking change de schéma). Réhydraté au démarrage → les prestations/checklists déjà consultées s'affichent hors connexion. Détection réseau 100 % JS (`src/lib/network.ts` : probe `fetch` + `AppState` sur `onlineManager`) → pause/reprise auto + `refetchOnReconnect`, **livrable en OTA** (pas de module natif). **Bandeau « Mode hors ligne »**. Les **mutations** sont en `networkMode: 'always'` → une action tentée hors ligne **échoue immédiatement** (pas de rejeu différé). Cache **purgé au logout**. **Exception : le pointage arrivée/départ a une file d'attente hors ligne dédiée** (`src/lib/pointageQueue.ts`) — photo+GPS capturés localement (photo copiée en durable via `expo-file-system`), **heure réelle** mémorisée, entrée persistée sur AsyncStorage ; au retour du réseau (`onlineManager`), la photo est uploadée puis le pointage POST avec `arrived_at`/`departed_at` (l'API enregistre l'heure fournie, pas l'heure de synchro). Bandeau « ⏳ en attente d'envoi » sur le détail ; couvre ménage (arrivée+déclaration, départ) et check-in/out. Livrable en OTA (100 % JS).

## Règles métier notables

- Tarifs d'un ménage modifiables par l'**admin** uniquement.
- Affecter un prestataire à un ménage = **admin** uniquement.
- Montants « gains/facturation » comptés sur ménages **terminés/validés**. CA = `client_price_ht` (+ blanchisserie client) ; coût = `provider_price` (+ blanchisserie presta). **Les gains comptent les ménages réalisés même si leur logement est archivé ensuite** (l'archivage ne doit pas effacer l'historique financier). La page dashboard « Archives » (clôturés validé/annulé) est désormais nommée **« Historique »**.
- URLs internes `/files` signées à la lecture. **Perf images** : le token d'URL a une expiration **arrondie à une fenêtre** (avatar/cover 24 h, photos d'intervention 1 h) → URL stable → le cache client (navigateur/`<Image>` RN) est réutilisé (avant : token glissant → re-téléchargement à chaque affichage). `/files` pose un `Cache-Control` (fichiers immuables). `POST /upload` génère et renvoie une **miniature** `thumbnail_url` (~400px) pour toute image ; stockée à côté de l'original (`photo.thumbnail_url`, `user.avatar_thumbnail_url`, `logement.cover_photo_thumbnail_url`) et affichée dans les listes/grilles, l'original ne servant qu'en plein écran.
