# Estia Menage — Modèle de données

Base : **PostgreSQL 17** · ORM : **Knex 3** · IDs : `uuid` (default `uuid()`).

## Tables (29)

### `user`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | varchar(255) unique notnull | |
| password_hash | varchar(255) notnull | bcrypt |
| first_name, last_name | varchar(100) notnull | |
| phone | varchar(20) | |
| avatar_url | varchar(500) | |
| role | enum `user_role` notnull default `prestataire` | `admin`, `prestataire` |
| company_name | varchar(200) | |
| is_active | boolean notnull default true | |
| organization_id | uuid FK organization | nullable initialement (rempli au register) |
| active_organization_id | uuid FK organization SET NULL | multi-org |
| current_mobile_session_id | varchar(64) | jti de la session mobile active. Une nouvelle connexion mobile remplace cette valeur et invalide les anciens tokens mobile. |
| current_web_session_id | varchar(64) | idem pour le dashboard. Mobile + web cohabitent — c'est tout l'intérêt de la migration `20260528170000_per_platform_sessions`. |
| created_at, updated_at | timestamp | |

### `refresh_token`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK user CASCADE notnull | |
| token | text unique notnull | |
| platform | varchar(10) | `'mobile'` ou `'web'`. Permet de cibler la purge des tokens d'une plateforme à la reconnexion. |
| created_at | timestamp | |

### `organization`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar(200) notnull | |
| created_by | uuid FK user | |
| siret | varchar(14) indexed | |
| legal_form, vat_number, naf_code | strings | |
| address, postal_code, city | strings | |
| country | varchar(2) default 'FR' | |
| phone, billing_email, website, logo_url | strings | |
| created_at, updated_at | timestamp | |

### `organization_member`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK organization CASCADE | |
| user_id | uuid FK user CASCADE | |
| role | enum `user_role` notnull | `admin/prestataire` |
| created_at, updated_at | timestamp | |
| UNIQUE(organization_id, user_id) | | |

### `invitation`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | varchar(255) notnull | |
| invited_by | uuid FK user notnull | |
| organization_id | uuid FK organization CASCADE notnull | |
| role | enum `user_role` notnull default `prestataire` | |
| token | varchar(255) unique notnull | |
| status | enum `invitation_status` notnull default `pending` | `pending/accepted/expired` |
| expires_at | timestamp notnull | |
| created_at | timestamp | |

### `logement`
Bien locatif paramétrable.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK organization CASCADE notnull | |
| created_by | uuid FK user notnull | |
| proprietaire_user_id | uuid FK user SET NULL | |
| name | varchar(200) notnull | |
| address, city, postal_code | strings | |
| latitude, longitude | decimal(10,7) | |
| **n_bedrooms** | int notnull default 0 | nb chambres |
| **n_bathrooms** | int notnull default 0 | nb salles de bain |
| **n_wc** | int notnull default 0 | nb WC |
| **n_kitchens** | int notnull default 1 | |
| **n_living_rooms** | int notnull default 1 | |
| **n_exterior_spaces** | int notnull default 0 | terrasses, balcons |
| **n_lit_simple** | int notnull default 0 | nb lits simples (couchage 1 personne) — défaut copié sur chaque ménage |
| **n_lit_double** | int notnull default 0 | nb lits doubles (couchage 2 personnes) — défaut copié sur chaque ménage |
| **n_canape_lit** | int notnull default 0 | nb canapés-lits — défaut copié sur chaque ménage |
| **n_lit_appoint** | int notnull default 0 | nb lits d'appoint — défaut copié sur chaque ménage |
| has_basement | boolean default false | |
| has_laundry | boolean default false | |
| surface_m2 | int | |
| notes | text | |
| key_safe_code | varchar(50) | code de boîte à clef (saisi par l'admin, visible aux membres du logement) ; UI masque le contenu avec un eye toggle |
| cover_photo_url | varchar(500) | URL d'une photo de couverture du logement (uploadée via flow `/upload`) |
| color | varchar(9) | code hex `#RRGGBB` utilisé pour différencier les ménages du logement dans les vues calendrier (mobile + dashboard) |
| archived_at | timestamp | soft delete |
| created_at, updated_at | timestamp | |

INDEX : `(organization_id)`, `(latitude, longitude)`.

### `menage`
Prestation de ménage datée.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| organization_id | uuid FK organization CASCADE notnull | |
| created_by | uuid FK user notnull | |
| prestataire_user_id | uuid FK user SET NULL | assigné |
| status | enum `menage_status` notnull default `a_venir` | `a_venir/en_cours/termine/valide/annule` |
| date_prevue | date notnull | date planifiée |
| date_locked | boolean notnull default false | Verrou contre la sync iCal. Posé à `true` quand l'admin approuve une demande de report avec `apply_to_menage`, ou qu'il modifie manuellement `date_prevue` sur un ménage rattaché à un calendrier externe. La sync iCal saute le `UPDATE date_prevue` sur ces lignes. |
| horaire_prevu | time | créneau |
| duree_estimee_min | int | |
| date_realisation | date | date effective (renseignée au départ) |
| arrived_at | timestamp | pointage arrivée prestataire |
| departed_at | timestamp | pointage départ |
| arrival_photo_url | varchar(500) | photo géolocalisée prise à l'arrivée (preuve de présence) |
| arrival_lat / arrival_lng | decimal(10,7) | coordonnées GPS au moment de la photo d'arrivée |
| departure_photo_url | varchar(500) | photo géolocalisée prise au départ |
| departure_lat / departure_lng | decimal(10,7) | coordonnées GPS au moment de la photo de départ |
| prix_prevu | decimal(10,2) | |
| validated_at | timestamp | validation rapport par manager |
| validated_by | uuid FK user SET NULL | |
| validated_price | decimal(10,2) | prix final (peut override prix_prevu) |
| **n_lit_simple** | int notnull default 0 | nb lits simples sur ce ménage (copié du logement à la création, override admin possible) |
| **n_lit_double** | int notnull default 0 | nb lits doubles sur ce ménage |
| **n_canape_lit** | int notnull default 0 | nb canapés-lits sur ce ménage |
| **n_lit_appoint** | int notnull default 0 | nb lits d'appoint sur ce ménage |
| notes_intervention | text | |
| archived_at | timestamp | |
| created_at, updated_at | timestamp | |

INDEX : `(logement_id, date_prevue)`, `(prestataire_user_id, status)`, `(organization_id, status)`.

### `logement_member`
Permissions permanentes par logement.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| user_id | uuid FK user CASCADE notnull | |
| role | enum `logement_member_role` notnull | `manager/prestataire/client_proprietaire` |
| can_view_comments, can_view_photos, can_view_checklist, can_view_team, can_edit | boolean notnull | flags granulaires d'accès (lecture/écriture du contenu) |
| can_view_prestataires | boolean notnull défaut false | voir la section "prestataires du logement" côté UI mobile |
| can_view_responsables | boolean notnull défaut false | voir la section "responsables du logement" |
| can_view_clients | boolean notnull défaut false | voir le client de facturation rattaché au logement |
| created_at, updated_at | timestamp | |
| UNIQUE(logement_id, user_id) | | |

Defaults appliqués à l'insert par `LogementMemberService.create` selon le rôle (cf. `DEFAULT_PERMISSIONS`) :
- `manager` : tous les flags à `true`
- `prestataire` : `view_comments`/`view_photos`/`view_checklist` à `true`, **toutes les visibilités à `false`** (discret par défaut)
- `client_proprietaire` : idem prestataire en lecture, plus toutes les visibilités à `true`

### `menage_check_section`
Pièce (section) de la checklist d'un ménage.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| section_type | varchar(50) notnull | `kitchen/living_room/bedroom/bathroom/wc/exterior/basement/laundry/general` |
| section_label | varchar(200) notnull | "Chambre 1", "Salle de bain 2", … |
| position | int notnull default 0 | |
| created_at, updated_at | timestamp | |

INDEX : `(menage_id, position)`.

### `menage_check_item`
Tâche validable d'une section.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| section_id | uuid FK menage_check_section CASCADE notnull | |
| item_label | varchar(300) notnull | "Aspirer le sol", … |
| position | int notnull default 0 | |
| validated_at | timestamp | quand validé |
| validated_by | uuid FK user SET NULL | par qui |
| comment | text | |
| created_at, updated_at | timestamp | |

INDEX : `(section_id, position)`.

### `photo`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| section_id | uuid FK menage_check_section SET NULL | rattachement optionnel |
| uploaded_by | uuid FK user notnull | |
| url, thumbnail_url, caption | strings | |
| latitude, longitude | decimal(10,7) | |
| **taken_at** | timestamp notnull | horodatage obligatoire |
| file_size | int | |
| mime_type | varchar(100) | |
| created_at, updated_at | timestamp | |

INDEX : `(menage_id, taken_at)`, `(section_id)`.

### `comment`
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| section_id | uuid FK menage_check_section SET NULL | optionnel |
| author_id | uuid FK user notnull | |
| content | text notnull | |
| created_at, updated_at | timestamp | |

INDEX : `(menage_id, created_at)`, `(section_id)`.

### `client`
**Fiche-annuaire pure** (facturation). Pas de compte/login : un client est une entrée d'annuaire admin-only, jamais un utilisateur authentifié. Le rôle global `client` a été supprimé (migration 20260528120000).

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK organization CASCADE notnull | |
| created_by | uuid FK user SET NULL | |
| first_name, last_name, company_name | varchar | au moins un requis côté API |
| email | varchar(255) | |
| phone | varchar(30) | |
| billing_address | varchar(500) | |
| postal_code, city | varchar | |
| country | varchar(2) | défaut `FR` |
| siret | varchar(14) | |
| vat_number | varchar(30) | |
| notes | text | |
| archived_at | timestamp | soft delete |
| created_at, updated_at | timestamp | |

INDEX : `(organization_id)`, `(siret)`.

### `logement_room`
Pièces d'un logement (chambre, salle de bain, etc).

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| name | varchar(200) notnull | |
| kind | varchar(50) | `chambre`, `salle_de_bain`, `wc`, `cuisine`, `salon`, `salle_a_manger`, `bureau`, `entree`, `couloir`, `exterieur`, `cave`, `buanderie`, `autre` |
| position | int | tri |
| notes | text | |
| created_at, updated_at | timestamp | |

INDEX : `(logement_id)`.

### `logement_check_template_section` / `logement_check_template_item`
Template de checklist paramétrable par logement. Utilisé à la création d'un ménage si présent, sinon fallback sur le plan par défaut basé sur les attributs du logement.

**section** :
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| logement_room_id | uuid FK logement_room SET NULL | section liée à une pièce |
| label | varchar(200) notnull | |
| position | int | tri |
| created_at, updated_at | timestamp | |

INDEX : `(logement_id)`.

**item** :
| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| section_id | uuid FK logement_check_template_section CASCADE notnull | |
| label | varchar(300) notnull | |
| position | int | tri |
| required | bool | défaut true |
| created_at, updated_at | timestamp | |

### `checklist_template` / `checklist_template_section` / `checklist_template_item`
Modèles de checklist **réutilisables au niveau de l'organisation**. À la création d'un logement, l'admin peut appliquer un modèle : ses sections+items sont copiés dans `logement_check_template_*`.

**checklist_template** : `id` PK · `organization_id` FK organization CASCADE notnull · `name` varchar(200) · timestamps. INDEX `(organization_id)`.
**checklist_template_section** : `id` PK · `template_id` FK checklist_template CASCADE notnull · `label` varchar(200) · `position` int · timestamps.
**checklist_template_item** : `id` PK · `section_id` FK checklist_template_section CASCADE notnull · `label` varchar(300) · `position` int · `required` bool défaut true · timestamps.

INDEX : `(section_id)`.

### `menage_reschedule_request`
Demande de changement de date par le prestataire.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| requested_by | uuid FK user CASCADE notnull | |
| original_date | date notnull | snapshot du `date_prevue` au moment de la demande |
| proposed_date | date notnull | |
| proposed_time | varchar(8) | optionnel `HH:MM[:SS]` |
| reason | text | |
| status | enum `reschedule_request_status` | `pending`, `approved`, `rejected`, `cancelled` |
| decided_by | uuid FK user SET NULL | |
| decided_at | timestamp | |
| decision_reason | text | |
| created_at, updated_at | timestamp | |

INDEX : `(menage_id)`, `(status)`, `(requested_by)`.

### `prestataire_weekly_availability`
Disponibilités hebdomadaires récurrentes d'un prestataire (boolean par jour, pas de plage horaire pour le MVP). 1 ligne par couple `(user, organization)`.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK user CASCADE notnull | |
| organization_id | uuid FK organization CASCADE notnull | |
| monday | bool notnull défaut false | |
| tuesday | bool notnull défaut false | |
| wednesday | bool notnull défaut false | |
| thursday | bool notnull défaut false | |
| friday | bool notnull défaut false | |
| saturday | bool notnull défaut false | |
| sunday | bool notnull défaut false | |
| created_at, updated_at | timestamp | |

UNIQUE : `(user_id, organization_id)` via `uniq_weekly_availability_user_org` — empêche les doublons d'upsert.

### `menage_response`
Réponse d'un prestataire à un ménage : "je peux le faire" (`present`) ou "je peux pas" (`absent`). Workflow type SportEasy : l'admin se sert ensuite des `present` pour affecter.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| user_id | uuid FK user CASCADE notnull | |
| status | enum `menage_response_status` notnull | `present`, `absent` |
| responded_at | timestamp défaut now | rafraîchi à chaque upsert |
| created_at, updated_at | timestamp | |

UNIQUE : `(menage_id, user_id)` via `uniq_menage_response_menage_user`.
INDEX : `(menage_id)`, `(user_id)`.

Contrôle applicatif (pas de FK supplémentaire) : le caller doit être `logement_member` avec `role='prestataire'` sur le logement parent du ménage pour pouvoir insérer/upsert.

### `menage_prestataire`
Table de jointure permettant d'affecter **plusieurs prestataires** à un même ménage. Le premier (par `created_at`) est le **référent** ; sa valeur est dénormalisée dans `menage.prestataire_user_id` pour rétro-compat avec les queries existantes.

**Affectation ponctuelle** : un prestataire de l'org peut être affecté à un ménage **sans être membre du logement** (cas remplacement). Il ne voit alors que ce ménage précis dans sa liste (la visibilité presta = membre prestataire du logement **OU** présent dans `menage_prestataire`). L'affectation n'exige donc plus que le user soit `logement_member`, seulement `organization_member` role=`prestataire`.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| user_id | uuid FK user CASCADE notnull | |
| created_at | timestamp défaut now | l'ordre d'arrivée détermine le référent (le plus ancien) |

UNIQUE : `(menage_id, user_id)` via `uniq_menage_prestataire` — empêche les doublons.
INDEX : `(menage_id)`, `(user_id)`.

Cohérence assurée par l'app : `MenagePrestataireService.setMenagePrestataires` / `addPrestataire` / `removePrestataire` maintiennent `menage.prestataire_user_id` synchronisé sur le primary (= row avec `created_at` minimal). Le `PATCH /menages/:id { prestataire_user_id }` historique synchronise également la jointure (full-replace).

Backfill (migration `20260521203227_create_menage_prestataire.js`) : pour chaque ménage existant avec `prestataire_user_id`, insertion de la row correspondante dans la jointure.

### `logement_external_calendar`
Calendriers externes (iCal Airbnb / Booking / Vrbo) connectés à un logement. Un worker (`ical-worker`, toutes les 30 min) synchronise les check-out → création auto de ménages.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| provider | enum external_calendar_provider | `ical` (défaut), `airbnb`, `booking`, `vrbo` |
| label | varchar(200) | nom affiché (optionnel) |
| url | varchar(1000) notnull | URL du flux iCal |
| enabled | bool notnull défaut true | sync activée |
| last_synced_at | timestamp | dernière sync réussie |
| last_error | text | dernière erreur de sync |
| created_at, updated_at | timestamp | |

Note : `menage` porte `external_source` (`cal_<provider>`), `external_event_uid` (UID du VEVENT) et **`external_calendar_id`** (FK `logement_external_calendar`, ON DELETE SET NULL) pour rattacher chaque ménage auto au calendrier précis qui l'a généré. La sync scope création/màj/annulation sur `external_calendar_id` — ainsi deux calendriers du même provider sur un logement ne s'annulent plus mutuellement.

### `error_log`
Journal des erreurs 500 (« Sentry maison »), alimenté en fire-and-forget par le plugin `error-handler` à chaque erreur inconnue (migration 20260604120000).

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| level | varchar(20) notnull | défaut `error` |
| message | text notnull | message de l'erreur |
| stack | text | stack trace (optionnel) |
| route | text | URL de la requête |
| method | varchar(10) | méthode HTTP |
| user_id | uuid FK user SET NULL | null si non authentifié |
| status_code | int | code HTTP (500) |
| request_id | varchar(100) | id de requête Fastify |
| created_at, updated_at | timestamp | INDEX sur `created_at` et `user_id` |

### `menage_view`
Suivi des consultations par utilisateur → badges « non-lus » du dashboard (migration 20260604130000). Une ligne = la dernière fois qu'un user a ouvert un onglet d'un ménage. Non-lus = items créés après `last_viewed_at`, en excluant les siens. Seuls les onglets `comments`, `comments_steps` (= `comment` avec `section_id`) et `photos` sont calculés ; `documents`/`emergencies`/`emergencies_claim` renvoient 0 (entités absentes).

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK user CASCADE notnull | |
| menage_id | uuid FK menage CASCADE notnull | |
| tab | varchar(40) notnull | comments, comments_steps, photos, documents, emergencies, emergencies_claim |
| last_viewed_at | timestamp notnull | défaut now |
| created_at, updated_at | timestamp | |

UNIQUE `(user_id, menage_id, tab)` · INDEX `(user_id, menage_id)`.

### `logement_consommable`
Liste de consommables paramétrée par l'admin pour un logement (PQ, savon, capsules…), avec seuil d'alerte (migration 20260605120000). Soft-delete via `archived_at` pour préserver l'historique des relevés.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| logement_id | uuid FK logement CASCADE notnull | |
| label | varchar(200) notnull | ex : Papier toilette |
| unit | varchar(30) | ex : rouleaux, capsules (optionnel) |
| seuil_alerte | int notnull défaut 1 | stock courant <= seuil → « à racheter » |
| position | int notnull défaut 0 | |
| archived_at | timestamp | soft-delete |
| created_at, updated_at | timestamp | INDEX `(logement_id)` |

### `menage_consommable_releve`
Relevé saisi par le prestataire au **pointage de fin** : quantité restante de chaque consommable, daté → historique par ménage. Le « stock courant » d'un logement = le relevé le plus récent de chaque consommable.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| menage_id | uuid FK menage CASCADE notnull | |
| logement_consommable_id | uuid FK logement_consommable CASCADE notnull | |
| qty | int notnull | quantité restante (0 = rupture) |
| recorded_by | uuid FK user SET NULL | qui a relevé |
| recorded_at | timestamp notnull | |
| created_at, updated_at | timestamp | |

UNIQUE `(menage_id, logement_consommable_id)` (upsert) · INDEX `(logement_consommable_id)`, `(menage_id)`.

### `device_token`
Tokens push Expo par appareil (multi-device) pour les notifications push (migration 20260613000000). Upsert sur `token` ; purge auto des tokens invalides (`DeviceNotRegistered`) à l'envoi.

| Col | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK user CASCADE notnull | |
| token | text unique notnull | `ExponentPushToken[...]` |
| platform | varchar(16) | `ios` / `android` |
| created_at, updated_at | timestamp | INDEX `(user_id)` |

---

## Évolutions de tables existantes

### `logement` (ajout)
- `client_id` uuid FK `client` SET NULL — rattachement à une fiche client.
- `key_safe_code` varchar(50) — code boîte à clef (UI mobile masque le contenu).
- `cover_photo_url` varchar(500) — URL d'une photo de couverture (cover image).

### `logement_room` (auto-génération)
Les pièces sont auto-générées par `LogementRoomService.generateForLogement` à la création et à la mise à jour d'un logement, basé sur les counts `n_*` et flags `has_*`. Voir `docs/API.md` § _Logement → Auto-génération des pièces_ pour le mapping et la convention de nommage.

Une migration de backfill (`20260521200355_backfill_logement_rooms.js`) a peuplé rétroactivement les pièces de tous les logements existants au moment du déploiement initial de la feature.

### `logement_member` (ajouts permissions de visibilité)
- `can_view_prestataires` bool notnull défaut `false` — voir la section prestataires du logement (UI)
- `can_view_responsables` bool notnull défaut `false` — voir la section responsables du logement (UI)
- `can_view_clients` bool notnull défaut `false` — voir le client de facturation du logement (UI)

Backfill : pour les rows existantes non-prestataire, les 3 flags sont mis à `true` (les managers et client_proprietaires gardent leur visibilité élargie). Les prestataires existants restent à `false` (discret par défaut).

### `menage` (ajouts pricing + linge)
- `client_price_ht` decimal(10,2) — prix facturé au client (HT)
- `client_vat_rate` decimal(5,2) défaut 20 — taux TVA en %
- `provider_price` decimal(10,2) — prix payé prestataire
- `currency` varchar(3) défaut `EUR`
- `laundry_included` bool défaut false
- `laundry_client_price_ht` decimal(10,2)
- `laundry_provider_price` decimal(10,2)

### `menage` (ajouts rappels push)
- `reminder_eve_sent_at` timestamp — rappel « veille 18h » envoyé (ou relance si non assigné). Anti-doublon worker.
- `reminder_2h_sent_at` timestamp — rappel « 2h avant l'horaire » envoyé. Géré par `reminder-worker` (tick 15 min, Europe/Paris).

### `photo` (ajouts pour photos logement)
- `menage_id` devient nullable
- `logement_id` uuid FK logement CASCADE — lien direct au logement (sans ménage)
- `logement_room_id` uuid FK logement_room SET NULL — rattachement à une pièce
- Contrainte CHECK : `menage_id IS NOT NULL OR logement_id IS NOT NULL`

---

## Relations clés

```
organization (id)
├─ organization_member (org_id, user_id) → user
├─ user (organization_id, active_organization_id)
├─ client (organization_id) → user (created_by)
├─ logement (organization_id, client_id?)
│  ├─ logement_member (logement_id, user_id) → user
│  ├─ logement_room (logement_id)
│  │  └─ photo (logement_room_id?)
│  ├─ logement_check_template_section (logement_id, logement_room_id?)
│  │  └─ logement_check_template_item (section_id)
│  └─ menage (logement_id, organization_id)
│     ├─ menage_check_section (menage_id)
│     │  └─ menage_check_item (section_id) → user (validated_by)
│     ├─ menage_reschedule_request (menage_id) → user (requested_by, decided_by)
│     ├─ menage_response (menage_id, user_id) — vote présent/absent du prestataire
│     ├─ menage_prestataire (menage_id, user_id) — multi-affectation (1er = référent)
│     ├─ photo (menage_id?, section_id?) → user (uploaded_by)
│     └─ comment (menage_id, section_id?) → user (author_id)
├─ prestataire_weekly_availability (organization_id, user_id) — dispo hebdo du presta
└─ invitation (organization_id) → user (invited_by)

user
├─ refresh_token
├─ device_token (user_id) — tokens push Expo (multi-device)
└─ menage (prestataire_user_id, validated_by)
```

Cascade delete sur `organization_id` → nettoie tout. Cascade `menage_id` → checklist + photos + comments. Cascade `section_id` → items. `SET NULL` sur les FK user secondaires (prestataire, validated_by, proprietaire) pour préserver l'historique.
