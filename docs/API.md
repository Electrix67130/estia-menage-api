# Estia Menage — API Reference

Tous les endpoints (sauf `/auth/register`, `/auth/login`, `/auth/refresh`, `/health`) requièrent :
- Header `Authorization: Bearer <access_token>`
- Header `x-api-key: <API_KEY>`

Réponses paginées : `{ data: [...], meta: { total, page, limit, totalPages } }`.

---

## Auth

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Inscription (crée auto une organization) |
| POST | `/auth/login` | Renvoie `{ user, access_token, refresh_token }` |
| POST | `/auth/refresh` | Renouvelle l'access_token |
| POST | `/auth/logout` | Invalide le refresh token (par device si on l'envoie dans le body) |
| GET  | `/auth/me` | Profil + organisation active |

### Sessions multi-plateforme

`/auth/register` et `/auth/login` acceptent un champ optionnel `platform: 'mobile' | 'web'` (default `'web'`). Le token émis contient la claim `platform`. Une session est gardée active par plateforme : se reconnecter sur la même plateforme (ex: nouveau mobile) éjecte l'ancienne session de cette plateforme mais ne touche pas l'autre — un user peut donc être connecté simultanément sur **un mobile + un dashboard**.

`/auth/logout` accepte un body optionnel `{ refresh_token }` : si fourni, seul le device courant est déconnecté ; sinon toutes les plateformes sont coupées (rétro-compat). Les frontends mobile + dashboard transmettent leur refresh token sur logout.

`POST /auth/register` body :
```json
{
  "email": "admin@estia.fr",
  "password": "min8chars",
  "first_name": "Admin",
  "last_name": "Estia",
  "phone": "0612345678",
  "company_name": "Estia SAS",
  "platform": "web"
}
```

`POST /auth/login` body :
```json
{ "email": "...", "password": "...", "platform": "mobile" }
```

---

## User

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/users` | Liste des users de l'org (admin) ou co-membres de logements |
| GET | `/users/search?q=...` | Recherche par nom/email |
| GET | `/users/:id` | Profil |
| PATCH | `/users/:id` | Édite son propre profil (ou admin pour role/is_active). `company_name` = admin-only (propagé org-wide + sync `organization.name`) ; `provider_company`/`provider_siret`/`provider_vat_number`/`provider_address` = entreprise perso du prestataire, éditables par lui-même, non propagées |
| GET | `/company/lookup?siret=` | Résout un SIRET (14 chiffres) via l'annuaire public et renvoie `{ siret, siren, name, address, vat_number }` (TVA FR calculée). Authentifié. |
| DELETE | `/users/:id` | Admin only |

---

## Organization

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/organizations/me` | Organisation active |
| PATCH | `/organizations/:id` | Met à jour (admin) |

## Organization member

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/organization-members/by-organization?organization_id=` | Liste membres |
| POST | `/organization-members/switch` | Bascule l'organisation active |

## Invitation

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/invitations` | Crée invitation (admin). Réutilise une invitation `pending`/`expired` existante pour le même email (dédup + purge des doublons) au lieu d'en créer une nouvelle. `409` si l'email est déjà membre de l'org. |
| POST | `/invitations/:id/resend` | Renvoie l'email + rafraîchit l'expiration +7j (admin, org-scoped) |
| GET | `/invitations/by-token?token=` | Vérifie un token |
| GET | `/invitations` | Liste (org-scoped). Réconcilie au passage : marque `accepted` les invitations `pending`/`expired` dont l'email est déjà membre de l'org. |
| POST | `/invitations/accept` | Accepte invitation (lors de register) |
| DELETE | `/invitations/:id` | Annule une invitation |

---

## Client

Fiche client (facturation). Pas de compte utilisateur — un client est juste une entité rattachée à un logement pour la facturation. Plusieurs logements peuvent être rattachés à un même client.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/clients?search=` | Liste paginée des clients de l'org |
| GET | `/clients/:id` | Détail |
| GET | `/clients/:id/logements` | Logements rattachés à ce client |
| GET | `/clients/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD` | **Rapport compta** détaillé sur la période : ménages (date, logement, prestataires, options linge, prix client HT/TVA, prix prestataire) via `logement.client_id`. Exclut les ménages annulés. Admin only. |
| POST | `/clients` | Création (admin) |
| PATCH | `/clients/:id` | Mise à jour (admin) |
| DELETE | `/clients/:id` | Archivage (soft delete, admin) |

`POST /clients` body :
```json
{
  "first_name": "Sophie",
  "last_name": "Bernard",
  "company_name": "Bernard Investissements",
  "email": "sophie@bernard-invest.fr",
  "phone": "+33611223344",
  "billing_address": "5 av. de la République",
  "postal_code": "75011",
  "city": "Paris",
  "country": "FR",
  "siret": "12345678900012",
  "vat_number": "FR12345678900",
  "notes": "Facturation trimestrielle"
}
```

Au moins un de `first_name`, `last_name` ou `company_name` est obligatoire.

---

## Logement

Bien locatif paramétrable. Source des paramètres de génération de checklist. Peut être rattaché à un `client` pour la facturation.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logements` | Liste paginée des logements de l'org (admin : tous ; non-admin : uniquement les logements où il est `logement_member`) |
| GET | `/logements/:id` | Détail (admin OK ; non-admin doit être membre du logement, sinon 404) |
| POST | `/logements` | Création (admin) — auto-génère les `logement_room` selon les counts |
| PATCH | `/logements/:id` | Mise à jour (admin) — si les counts augmentent, ajoute les `logement_room` manquantes (idempotent) |
| DELETE | `/logements/:id` | Archivage (soft delete, admin) |

`POST /logements` body :
```json
{
  "name": "Studio Bastille",
  "address": "12 rue de la Roquette",
  "city": "Paris",
  "postal_code": "75011",
  "n_bedrooms": 1,
  "n_bathrooms": 1,
  "n_wc": 1,
  "n_kitchens": 1,
  "n_living_rooms": 1,
  "n_exterior_spaces": 1,
  "n_lit_simple": 1,
  "n_lit_double": 1,
  "n_canape_lit": 0,
  "n_lit_appoint": 0,
  "has_basement": false,
  "has_laundry": true,
  "has_pool": false,
  "has_jacuzzi": false,
  "enable_check_in": false,
  "enable_check_out": false,
  "surface_m2": 35,
  "notes": "Code interphone : 1234B",
  "key_safe_code": "1234",
  "cover_photo_url": "https://api.../uploads/cover.jpg",
  "proprietaire_user_id": "uuid",
  "client_id": "uuid"
}
```

Champs spécifiques :
- `key_safe_code` (string, max 50) — code de boîte à clef, masqué par défaut côté UI mobile (eye toggle pour révéler). Visible à l'admin + à tout `logement_member` (les prestas en ont besoin pour entrer).
- `cover_photo_url` (string, max 500) — URL d'une photo de profil/cover du logement (uploadée via le flow `/upload` puis PATCH avec l'URL retournée).
- `n_lit_simple` / `n_lit_double` / `n_canape_lit` / `n_lit_appoint` (int 0-50, default 0) — composition des lits du bien. Ces valeurs sont **copiées sur chaque nouveau ménage** à la création (cf. `POST /menages`) puis modifiables indépendamment par ménage (saisonnalité, demande spéciale).
- `enable_check_in` / `enable_check_out` (bool, default false) — activent les prestations check-in (accueil/remise de clés) et check-out (état des lieux) sur le logement. Une fois activées, ces prestations sont matérialisées comme `menage.prestation_type='check_in'`/`'check_out'` (via sync iCal + création manuelle).

### Auto-génération des pièces

À la création (POST) et au PATCH d'un logement, `LogementRoomService.generateForLogement` est appelé en best-effort (les erreurs sont loggées mais ne bloquent pas la réponse) :

- Pour chaque champ `n_*` (`n_bedrooms`, `n_bathrooms`, `n_wc`, `n_kitchens`, `n_living_rooms`, `n_exterior_spaces`), crée les pièces manquantes du `kind` correspondant pour atteindre le count cible.
- Pour les flags (`has_basement`, `has_laundry`), crée la pièce associée si elle n'existe pas encore.
- Convention de nommage : singulier si `target=1` et aucune pièce existante (`"Chambre"`), sinon numéroté (`"Chambre 1"`, `"Chambre 2"`...).
- **Idempotent** : un re-run n'ajoute rien si les counts sont déjà atteints. Les pièces existantes ne sont jamais renommées ni supprimées, même si on baisse un count — la suppression reste manuelle via `DELETE /logement-rooms/:id`.

Mapping `n_*` → kind :

| Champ logement | RoomKind | Nom |
|---|---|---|
| `n_bedrooms` | `chambre` | Chambre |
| `n_bathrooms` | `salle_de_bain` | Salle de bain |
| `n_wc` | `wc` | WC |
| `n_kitchens` | `cuisine` | Cuisine |
| `n_living_rooms` | `salon` | Salon |
| `n_exterior_spaces` | `exterieur` | Extérieur |
| `has_basement` | `cave` | Cave |
| `has_laundry` | `buanderie` | Buanderie |
| `has_pool` | `piscine` | Piscine |
| `has_jacuzzi` | `jacuzzi` | Jacuzzi |

---

## Logement room

Pièces du logement, **100% personnalisables** : nom libre + photo de couverture (`photo_url`). Plus de type imposé ni d'auto-génération — l'utilisateur ajoute les pièces qu'il veut.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logement-rooms?logement_id=` | Liste des pièces d'un logement |
| GET | `/logement-rooms/:id` | Détail |
| POST | `/logement-rooms` | Création (admin) |
| PATCH | `/logement-rooms/:id` | Mise à jour (admin) |
| DELETE | `/logement-rooms/:id` | Suppression (admin) |

`POST /logement-rooms` body :
```json
{
  "logement_id": "uuid",
  "kind": "salle_de_bain",
  "photo_url": "https://api.estia-clean-connect.fr/files/<uuid>.jpg",
  "position": 0,
  "notes": "Lit king size"
}
```

- `kind` — type de pièce (envoyé par l'UI récente). Quand il est fourni et ≠ `autre`, le `name` est **auto-généré** depuis le type (« Salle de bain 1 », « Salle de bain 2 »… indice anti-collision). Optionnel pour rétro-compat (anciens clients mobiles qui n'envoient que `name`).
- `name` — requis si **pas de `kind`** ou si `kind: "autre"` (nom libre). Ignoré quand un `kind` non-`autre` est fourni.
- `PATCH` : changer le `kind` vers un type non-`autre` (sans `name`) redérive le nom.

`name` est libre. `photo_url` (optionnel) est signé à la lecture. `kind` est conservé en legacy (optionnel) mais n'est plus imposé ni utilisé par l'UI.

---

## Logement check template

Checklist paramétrable par logement (utilisée à la création d'un ménage à la place du plan auto-généré, si présente).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logement-check-templates?logement_id=` | Tree complet (sections + items) |
| POST | `/logement-check-template-sections` | Crée une section (admin) |
| PATCH | `/logement-check-template-sections/:id` | Modifie une section (admin) |
| DELETE | `/logement-check-template-sections/:id` | Supprime une section (admin) |
| POST | `/logement-check-templates/:logement_id/reorder-sections` | Réordonne — body `{ ordered_ids: [...] }` |
| POST | `/logement-check-template-items` | Crée un item (admin) |
| PATCH | `/logement-check-template-items/:id` | Modifie un item (admin) |
| DELETE | `/logement-check-template-items/:id` | Supprime un item (admin) |
| POST | `/logement-check-template-sections/:section_id/reorder-items` | Réordonne items dans une section |

Quand un ménage est créé, le service vérifie s'il y a au moins une section template définie sur le logement. Si oui, c'est ce template qui est instancié dans `menage_check_section`/`menage_check_item`. Sinon le plan par défaut basé sur les attributs du logement est utilisé.

## Logement member

Permissions permanentes par logement (manager / prestataire / client_proprietaire).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logement-members/by-logement?logement_id=` | Liste membres (join `user` : `first_name`, `last_name`, `email`, `phone`, `company_name`, `avatar_url`) |
| POST | `/logement-members` | Ajoute un membre (admin / créateur / manager) |
| PATCH | `/logement-members/:id` | Modifie rôle/permissions (admin / créateur) |
| DELETE | `/logement-members/:id` | Retire membre |

Flags de permission disponibles à la création / au PATCH :
- `can_view_comments`, `can_view_photos`, `can_view_checklist`, `can_view_team`, `can_edit` — permissions historiques (lecture des comments, photos, checklist, équipe ; édition du logement).
- `can_view_prestataires`, `can_view_responsables`, `can_view_clients` — permissions granulaires de **visibilité** sur les autres membres du logement (vue mobile : sections cachées si false). L'admin org voit tout, indépendamment de ces flags.

Permissions par défaut selon rôle (cf. `logement-member.service.ts`):
- `manager` : tout (incl. can_edit, can_view_team, can_view_prestataires/responsables/clients)
- `prestataire` : view_comments / view_photos / view_checklist ; visibilités prestataires/responsables/clients à **`false`** (discret par défaut — l'admin peut élargir au cas par cas)
- `client_proprietaire` : idem prestataire pour la lecture, plus toutes les visibilités à `true`

---

## Logement external calendar (iCal Airbnb / Booking…)

Calendriers iCal externes rattachés à un logement. **Admin only** (même org que le logement). Un worker (`src/lib/ical-worker.ts`) synchronise les calendriers activés **toutes les 30 min** : il crée/met à jour/annule les `menage` correspondants (parser RFC 5545 maison, respect de `date_locked`). Le dashboard expose la config dans la fiche logement (section « Calendriers externes »).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logement-external-calendars?logement_id=` | Liste des calendriers du logement → `{ data: [...] }` (admin) |
| POST | `/logement-external-calendars` | Ajoute un calendrier (admin) |
| PATCH | `/logement-external-calendars/:id` | Modifie (`url`, `provider`, `label`, `enabled`) (admin) |
| DELETE | `/logement-external-calendars/:id` | Supprime (admin) — n'efface pas les ménages déjà créés |
| POST | `/logement-external-calendars/:id/sync` | Déclenche une synchro manuelle (admin) |

`POST /logement-external-calendars` body :
```json
{
  "logement_id": "uuid",
  "url": "https://www.airbnb.fr/calendar/ical/123.ics?s=...",
  "provider": "airbnb",
  "label": "Annonce Airbnb",
  "enabled": true
}
```

- `provider` ∈ `airbnb` | `booking` | `vrbo` | `ical` (défaut `ical`). `url` (requise, ≤1000). `label` optionnel. `enabled` défaut `true`.
- Champs lecture : `last_synced_at`, `last_error` (dernière erreur de fetch/parse).
- `POST …/:id/sync` réponse : `{ fetched_events, created_menages, updated_menages, cancelled_menages, error?, calendar }`.

---

## Menage

Prestation de ménage datée, FK logement + prestataire.

Chaque ménage sérialisé (liste **et** détail) inclut un booléen calculé **`needs_attention`** : `true` quand le jour prévu est passé, qu'aucun pointage d'arrivée n'a été enregistré (`arrived_at` vide) et que le statut est encore `a_venir`. Sert à mettre le ménage en évidence (badge « Non pointé » + carte surlignée) côté dashboard et mobile.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menages?status=&type=&prestataire_user_id=&logement_id=&validated=&unassigned=&manager=me&from=&to=` | Liste filtrable. `type` = `menage`\|`check_in`\|`check_out` (défaut : tous types). Chaque ménage inclut un booléen `has_pending_reschedule` (true s'il existe au moins une `menage_reschedule_request` `status='pending'`) — sert à afficher un badge "demande en attente" sur les cards admin. |
| GET | `/menages/:id` | Détail (inclut aussi `has_pending_reschedule`). |
| GET | `/menages/:id/eligible-prestataires` | **Tous** les prestataires de l'org, avec un flag `is_member` (membre prestataire du logement). Les non-membres peuvent être affectés **ponctuellement** (remplacement) — ils ne reçoivent que ce ménage |
| POST | `/menages` | Création (admin) — **génère auto la checklist**. Accepte `prestation_type` (`menage` par défaut) pour créer un check-in/check-out manuellement. |
| PATCH | `/menages/:id` | Mise à jour (manager/admin via can_edit) — accepte `prestataire_user_id` pour affecter/désaffecter. **Changement de `status` = admin uniquement** (correction d'un statut erroné) : repasser en `a_venir` efface `arrived_at`+`departed_at`, repasser en `en_cours` efface `departed_at` (sauf valeurs explicitement fournies). Si on modifie `date_prevue` sur un ménage rattaché à un calendrier externe, `date_locked` est posé à `true` automatiquement (sauf valeur explicite). |
| DELETE | `/menages/:id` | Suppression (admin) |
| POST | `/menages/:id/arrival` | Pointage arrivée (prestataire assigné) — body `{ photo_url, lat, lng, traveler_rating?, has_degradation?, degradation_note?, degradation_photos? }`. Photo géolocalisée obligatoire. `traveler_rating` 1-5. Si `has_degradation`, `degradation_photos: [{ url, thumbnail_url?, file_size?, mime_type? }]` est enregistré dans `photo` avec `is_degradation=true`. Nouveaux champs optionnels (rétro-compat). |
| POST | `/menages/:id/departure` | Pointage départ (prestataire assigné) — body `{ photo_url, lat, lng }` |
| POST | `/menages/:id/validate` | Validation rapport — body `{ price?: number }` |
| GET | `/me/earnings?from=&to=&validated_only=` | Bilan gains du prestataire connecté. Inclut les ménages où il est référent **ou** affecté via `menage_prestataire` (multi-affectation, remplacement ponctuel). |
| GET | `/users/:user_id/earnings?from=&to=&validated_only=` | Bilan gains d'un prestataire (admin only). |
| GET | `/admin/earnings?from=&to=&validated_only=` | Vue globale admin : total org + breakdown **`by_client`** + **`by_prestataire`**. Pour le breakdown presta, le `provider_price` d'un ménage multi-affecté est réparti à parts égales entre les prestas assignés (le total reconcilie avec `by_client`). |

### Modèles de checklist (org)

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/checklist-templates` | Liste des modèles de l'org (avec `section_count`) |
| GET | `/checklist-templates/:id` | Modèle + arbre complet (sections → items) |
| POST | `/checklist-templates` | Créer (admin) — body `{ name, sections: [{ label, items: [{ label, required }] }] }` |
| PATCH | `/checklist-templates/:id` | Modifier (admin) — `sections` fourni = remplace tout l'arbre |
| DELETE | `/checklist-templates/:id` | Supprimer (admin) |
| POST | `/logements/:id/apply-checklist-template` | Appliquer un modèle au logement (admin) — body `{ template_id }` ; copie sections+items dans `logement_check_template_*` (ajoute à la suite) |

Filtre `unassigned=true` : ne retourne que les ménages sans prestataire (utile pour le calendrier admin). `unassigned=false` : que les ménages déjà affectés.

Filtre `closed` : `closed=true` = uniquement les ménages clôturés (`valide`/`annule`) → Archives ; `closed=false` = worklist active (exclut `valide`/`annule`). Combinable avec `logement_id`, `prestataire_user_id`, `from`/`to`, pagination.

`GET /me/earnings` réponse :
```json
{
  "total": 540.00,
  "currency": "EUR",
  "count": 7,
  "from": "2026-05-01",
  "to": "2026-05-31",
  "items": [
    {
      "id": "uuid",
      "date_prevue": "2026-05-15",
      "logement_id": "uuid",
      "status": "valide",
      "provider_price": "50.00",
      "laundry_provider_price": "8.00",
      "laundry_included": true,
      "subtotal": 58,
      "validated_at": "2026-05-15T14:30:00Z"
    }
  ]
}
```

`GET /admin/earnings` réponse :
```json
{
  "total": 1860.00,
  "currency": "EUR",
  "count": 24,
  "from": "2026-05-01",
  "to": "2026-05-31",
  "by_client": [
    { "id": "uuid", "name": "Eiffage SAS", "total": 920.00, "count": 12 },
    { "id": "__no_client__", "name": "Sans client", "total": 80.00, "count": 1 }
  ],
  "by_prestataire": [
    { "id": "uuid", "name": "Marie Dupont", "total": 720.00, "count": 10 },
    { "id": "uuid", "name": "Paul Martin", "total": 540.00, "count": 7.5 }
  ]
}
```
(`by_prestataire.count` peut être fractionnaire si certains ménages sont multi-prestas et donc partagés.)

`POST /menages` body :
```json
{
  "logement_id": "uuid",
  "prestataire_user_id": "uuid (optional)",
  "date_prevue": "2026-05-20",
  "horaire_prevu": "14:00",
  "duree_estimee_min": 90,
  "prix_prevu": 80,
  "client_price_ht": 95,
  "client_vat_rate": 20,
  "provider_price": 50,
  "currency": "EUR",
  "laundry_included": true,
  "laundry_client_price_ht": 15,
  "laundry_provider_price": 8,
  "n_lit_simple": 1,
  "n_lit_double": 1,
  "n_canape_lit": 0,
  "n_lit_appoint": 0,
  "notes_intervention": "Inclure le nettoyage du four"
}
```

**Champs financiers** :
- `client_price_ht` / `client_vat_rate` : prix facturé au client (HT) + taux TVA en %. Calcul TTC à l'affichage.
- `provider_price` : montant payé au prestataire.
- `laundry_*` : option linge (si `laundry_included=true`).

**Composition des lits** :
- `n_lit_simple` / `n_lit_double` / `n_canape_lit` / `n_lit_appoint` (int 0-50, optionnel) — **lits à faire** pour ce ménage. Si non fournis, copiés depuis le logement parent. Modifiables ensuite via `PATCH /menages/:id` (admin uniquement, lecture seule côté prestataire).
- `n_travelers` (int 0-50, optionnel) — **nombre de voyageurs** du séjour (saisi par l'admin ; l'iCal ne le fournit pas de façon fiable). Sert à dimensionner les lits à faire. `stay_nights` (durée du séjour) est, lui, dérivé de l'iCal.

**Access control sur la réponse** :
- Admin / manager : voient tous les champs.
- Prestataire assigné : voit `provider_price` + `laundry_provider_price` mais PAS `client_price_ht` / `client_vat_rate` / `laundry_client_price_ht`.
- Autres membres du logement : ne voient aucun champ financier.

Statuts ménage : `a_venir → en_cours → termine → valide` (ou `annule`).

`POST /menages/:id/validate` body :
```json
{ "price": 95 }
```
Le `price` (optionnel) remplace `prix_prevu` dans `validated_price` (utile pour majoration en cas de logement très sale).

Filtre "mes rapports non validés" (côté manager) :
```
GET /menages?validated=false&manager=me
```

---

## Menage prestataires (multi-affectation)

Un même ménage peut être affecté à **plusieurs prestataires** via la table de jointure `menage_prestataire`. Le 1er prestataire (par `created_at`) est le **référent** ; sa valeur est dénormalisée dans `menage.prestataire_user_id` pour rétro-compat avec les queries existantes (filter, sort, picker mobile legacy).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menages/:id/prestataires` | Liste des prestataires affectés (enrichis user + `is_primary`) — tout membre de l'org |
| PUT | `/menages/:id/prestataires` | Full-replace : remplace toute la liste (admin) |
| POST | `/menages/:id/prestataires/:user_id` | Ajout unitaire (admin) — idempotent |
| DELETE | `/menages/:id/prestataires/:user_id` | Retrait unitaire (admin) — si c'était le référent, le suivant devient référent |

`PUT /menages/:id/prestataires` body :
```json
{
  "prestataire_user_ids": ["uuid1", "uuid2", "uuid3"]
}
```
- Liste vide = tout désaffecter (le `menage.prestataire_user_id` passe à `null`).
- Premier UUID = devient le **référent** (denormalisé dans `menage.prestataire_user_id`).
- Validation : chaque user_id doit être `logement_member` avec `role='prestataire'` sur le logement parent ; sinon 400.

`GET /menages/:id/prestataires` réponse :
```json
{
  "data": [
    {
      "id": "uuid",
      "menage_id": "uuid",
      "user_id": "uuid",
      "created_at": "2026-05-21T20:36:12.992Z",
      "first_name": "Marie",
      "last_name": "Dupont",
      "email": "marie@…",
      "avatar_url": null,
      "is_primary": true
    },
    {
      "id": "uuid",
      "menage_id": "uuid",
      "user_id": "uuid",
      "created_at": "2026-05-21T20:36:12.993Z",
      "first_name": "Paul",
      "last_name": "Martin",
      "email": "paul@…",
      "avatar_url": null,
      "is_primary": false
    }
  ]
}
```

**Note transition** : le `PATCH /menages/:id { prestataire_user_id }` historique reste fonctionnel et synchronise la jointure (le user défini devient le seul prestataire). Pour affecter plusieurs prestas, utiliser `PUT /menages/:id/prestataires`.

---

## Menage check (checklist)

Sections (= pièces) et items générés automatiquement à la création du ménage.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menages/:menage_id/check` | Arbre sections + items |
| POST | `/menage-check-sections` | Ajout manuel section (admin/manager) |
| PATCH | `/menage-check-sections/:id` | Renomme section |
| DELETE | `/menage-check-sections/:id` | Supprime section |
| POST | `/menages/:menage_id/check/sections/reorder` | Body `{ ordered_ids: [...] }` |
| POST | `/menages/:menage_id/check/toggle-all` | Coche/décoche **toute** la checklist — body `{ validated }` (presta assigné ou edit) → renvoie l'arbre |
| POST | `/menage-check-sections/:id/toggle-all` | Coche/décoche **toute la section** — body `{ validated }` (presta assigné ou edit) → renvoie l'arbre |
| POST | `/menage-check-items` | Ajout item |
| PATCH | `/menage-check-items/:id` | Modifie item (label, comment) |
| DELETE | `/menage-check-items/:id` | Supprime item |
| POST | `/menage-check-sections/:id/items/reorder` | Body `{ ordered_ids: [...] }` |
| POST | `/menage-check-items/:id/toggle` | Valide/dévalide item — body `{ validated: bool, comment?: string }` |

Types de section : `kitchen, living_room, bedroom, bathroom, wc, exterior, basement, laundry, general`.

La lecture (`GET …/check`) et le toggle sont accessibles à tout **prestataire affecté au ménage** — référent (`prestataire_user_id`) **ou** multi-affecté (`menage_prestataire`), remplaçant non membre du logement inclus — OU à toute personne avec `view_checklist` (lecture) / `can_edit` (toggle) sur le logement.

---

## Menage reschedule request

Demande de changement de date par le prestataire, à valider par l'admin.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/reschedule-requests?status=&menage_id=&requested_by=` | Liste (admin = tout l'org, sinon ses propres demandes) |
| GET | `/reschedule-requests/:id` | Détail |
| POST | `/reschedule-requests` | Création. Autorisé pour : admin, référent (`prestataire_user_id`), presta multi-affecté (`menage_prestataire`), ou tout presta **membre du logement** parent — y compris s'il n'est pas encore affecté (utile pour signaler une indisponibilité avant l'attribution). |
| POST | `/reschedule-requests/:id/decide` | Approuver/refuser (admin). `apply_to_menage=true` met à jour `menage.date_prevue` + `horaire_prevu` ET pose `date_locked = true` (la sync iCal ne ré-écrasera pas la date). |
| POST | `/reschedule-requests/:id/cancel` | Annuler sa propre demande |

`POST /reschedule-requests` body :
```json
{
  "menage_id": "uuid",
  "proposed_date": "2026-05-22",
  "proposed_time": "10:00",
  "reason": "Imprévu personnel"
}
```

`POST /reschedule-requests/:id/decide` body :
```json
{
  "decision": "approved",
  "decision_reason": "OK pour décaler",
  "apply_to_menage": true
}
```
Si `decision=approved` et `apply_to_menage=true` (défaut), `menage.date_prevue` et `menage.horaire_prevu` sont mis à jour.

Statuts : `pending → approved | rejected | cancelled`. Une demande non-pending ne peut plus être décidée.

---

## Prestataire — disponibilités hebdomadaires

Disponibilités récurrentes par jour de la semaine (boolean par jour, pas de plage horaire).
1 ligne par couple `(user, organisation active)` — la même personne peut être prestataire dans plusieurs orgs avec des dispos différentes.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/prestataires/me/weekly-availability` | Ma propre dispo hebdo (crée une ligne tout-à-false au premier appel) |
| PATCH | `/prestataires/me/weekly-availability` | Upsert d'un ou plusieurs jours |
| GET | `/prestataires/weekly-availability?user_ids=u1,u2` | Lecture batch (admin uniquement) |

`PATCH` body (tous les champs optionnels) :
```json
{
  "monday": true,
  "tuesday": false,
  "wednesday": true,
  "thursday": false,
  "friday": true,
  "saturday": false,
  "sunday": false
}
```

Réponse `GET` :
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "organization_id": "uuid",
  "monday": true,
  "tuesday": false,
  "wednesday": true,
  "thursday": false,
  "friday": true,
  "saturday": false,
  "sunday": false,
  "created_at": "2026-05-21T...",
  "updated_at": "2026-05-21T..."
}
```

Le réglage est un **hint** affiché à l'admin lors de l'affectation, **pas une contrainte dure** : un presta marqué "non dispo le lundi" peut quand même répondre "présent" à un ménage du lundi (override manuel).

---

## Menage response (présent / absent)

Workflow inspiré de SportEasy : pour chaque ménage à venir sur un logement où il est membre `role='prestataire'`, le prestataire indique s'il peut le faire. L'admin se sert ensuite des "présents" pour affecter.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menages/:id/responses` | Liste des réponses (admin ou tout membre du logement parent) |
| POST | `/menages/:id/responses` | Upsert une réponse — presta pour lui-même, ou admin pour un autre presta via `user_id` |
| GET | `/prestataires/me/menages?from=&to=&mode=` | Mes ménages avec ma réponse. `mode=upcoming` (défaut) : à venir (statuts non-`annule`/`valide`, défaut today→+90j). `mode=history` : déjà faits (`termine`/`valide`, défaut -180j→today). |

`POST /menages/:id/responses` body :
```json
{ "status": "present" }
```
ou (admin uniquement, override pour un prestataire donné) :
```json
{ "status": "absent", "user_id": "<uuid-du-presta>" }
```

Règles :
- **Cas normal** : le caller doit être `logement_member` avec `role='prestataire'` sur le logement parent du ménage.
- **Admin override** : si `user_id` est fourni et différent du caller, seul un admin de l'org peut l'utiliser. Le `user_id` cible doit être presta sur le logement.
- Impossible si le ménage est déjà `valide` (le workflow est figé).
- Upsert : un 2e appel sur le même `(menage, user)` met à jour la réponse (`responded_at` rafraîchi).

`GET /menages/:id/responses` réponse :
```json
{
  "data": [
    {
      "id": "uuid",
      "menage_id": "uuid",
      "user_id": "uuid",
      "status": "present",
      "responded_at": "2026-05-21T...",
      "first_name": "Marie",
      "last_name": "Dupont",
      "email": "marie@…",
      "avatar_url": null
    }
  ]
}
```

`GET /prestataires/me/menages?from=YYYY-MM-DD&to=YYYY-MM-DD` réponse (defaults : `from=aujourd'hui`, `to=aujourd'hui+90j`) :
```json
{
  "data": [
    {
      "id": "uuid",
      "logement_id": "uuid",
      "logement_name": "Epicure",
      "logement_address": "12 Rue du Général de Gaulle",
      "logement_city": "Urmatt",
      "logement_color": "#3B82F6",
      "date_prevue": "2026-05-25T00:00:00.000Z",
      "horaire_prevu": "10:00:00",
      "duree_estimee_min": null,
      "status": "a_venir",
      "my_response": "present",
      "is_assigned": false,
      "assigned_to_someone": false,
      "referent_first_name": null,
      "referent_last_name": null,
      "done_by_me": false
    }
  ]
}
```

Champs dérivés (par user appelant) :
- `is_assigned` : le user est dans `menage_prestataire` de ce ménage.
- `assigned_to_someone` : au moins un prestataire est affecté (peu importe lequel).
- `referent_first_name` / `referent_last_name` : prestataire référent (`menage.prestataire_user_id`).
- `done_by_me` : le référent est l'user appelant.

Le endpoint filtre :
- ménages sur logements où l'user est `logement_member` role=`prestataire`
- statut ∉ {`annule`, `valide`} (workflow en cours seulement)
- `archived_at IS NULL`
- `date_prevue` dans `[from, to]`
- **visibilité affectation** : on garde uniquement les ménages **non affectés** (phase de vote ouverte) ET ceux où l'user **est affecté**. Dès qu'un ménage est attribué à quelqu'un d'autre, il **disparaît** de sa liste (pas de "non retenu").

---

## Photo

Une photo peut être rattachée à un **ménage** (avec ou sans `section_id`) OU directement à un **logement** (avec un `logement_room_id` optionnel pour la rattacher à une pièce). Au moins l'un des deux (`menage_id` ou `logement_id`) doit être fourni.

> **Accès aux photos d'un ménage** (GET/POST `menage_id`) : autorisé si l'utilisateur est **affecté au ménage** (référent `prestataire_user_id` **ou** multi-affecté via `menage_prestataire`) — y compris un remplaçant non membre du logement — OU s'il a la permission logement (`view_photos` pour lire, `can_edit` pour poster ; admin/créateur inclus). La suppression reste réservée à l'uploader ou à `can_edit`.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/photos?menage_id=&section_id=` | Photos du ménage (affecté au ménage OU `view_photos`) — `section_id` filtre par pièce |
| GET | `/photos?logement_id=&logement_room_id=` | Photos du logement (et filtrage par pièce) |
| GET | `/photos/:id` | Détail |
| POST | `/photos` | Upload — body inclut `menage_id` OU `logement_id` |
| DELETE | `/photos/:id` | L'uploader ou admin (logement) / can_edit (ménage) |

`POST /photos` body (photo de ménage) :
```json
{
  "menage_id": "uuid",
  "section_id": "uuid (optional)",
  "url": "https://...",
  "taken_at": "2026-05-15T14:30:00Z"
}
```

`POST /photos` body (photo de logement) :
```json
{
  "logement_id": "uuid",
  "logement_room_id": "uuid (optional)",
  "url": "https://...",
  "taken_at": "2026-05-15T14:30:00Z",
  "caption": "Vue d'ensemble cuisine"
}
```

Champs supportés (`POST /photos`) :
- `menage_id` : photo prise pendant un ménage
- `section_id` : optionnel, rattache à une `menage_check_section`
- `logement_id` : photo de la fiche logement (sans ménage)
- `logement_room_id` : optionnel, rattache à une pièce du logement
- `url` (req), `thumbnail_url`, `caption`
- `taken_at` (req), `latitude`, `longitude`, `file_size`, `mime_type`

L'upload du fichier lui-même passe par `POST /upload` (multipart) qui retourne une URL signée.

> `POST /photos` a un rate-limit dédié **200/min** (aligné sur `/upload`) : un envoi groupé génère une requête `/upload` + une requête `/photos` par photo, ce qui dépasserait vite le rate-limit global de 100/min.

---

## Upload de fichiers

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/upload` | Upload multipart (champ fichier). Authentifié. Max 10 Mo. Rate-limit dédié **200/min** (envoi groupé de photos). Images optimisées serveur (resize 2000px, recompression, strip EXIF). |
| GET | `/files/token/:filename` | Génère une URL de téléchargement signée (token TTL 5 min). Authentifié. |
| GET | `/files/:filename?t=<token>` | Sert le fichier si le token est valide (pas d'API key requise). |

`POST /upload` réponse `201` :
```json
{
  "url": "https://api.estia-clean-connect.fr/files/<uuid>.jpg",
  "original_name": "photo.jpg",
  "file_size": 824513,
  "mime_type": "image/jpeg"
}
```

**Optimisation automatique des images** : tout fichier `image/*` est, à l'upload,
auto-orienté (EXIF), redimensionné pour tenir dans **2000×2000 px** (sans
agrandissement), recompressé (qualité ~80, JPEG via mozjpeg) et débarrassé de ses
métadonnées. `file_size` reflète la taille **après** optimisation. Les fichiers
non-image sont stockés tels quels.

**Stockage** : piloté par `STORAGE_MODE`. En `local`, les fichiers sont sur le
disque du serveur et servis directement. En `s3` (Scaleway Object Storage),
`GET /files/:filename` redirige (302) vers une URL présignée. Le contrat HTTP est
identique dans les deux modes — le client passe toujours par les routes `/files`.

---

## Comment

Discussion liée à un ménage, optionnellement scopée à une section.

> **Accès** : lire/écrire un commentaire est autorisé si l'utilisateur est **affecté au ménage** (référent ou multi-affecté, remplaçant inclus) OU a `view_comments` sur le logement (admin/créateur inclus). L'édition/suppression d'un commentaire d'autrui requiert `can_edit`.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/comments?menage_id=&section_id=` | Liste (affecté au ménage OU `view_comments`) — section_id='general' pour hors-section |
| GET | `/comments/:id` | Détail |
| POST | `/comments` | Crée un commentaire |
| PATCH | `/comments/:id` | Édite (auteur uniquement) |
| DELETE | `/comments/:id` | Supprime (auteur ou edit perm) |

---

## Consommables (par logement)

Liste de consommables par logement (config admin) + relevé de quantité restante à chaque pointage de fin par le prestataire. Indicateur « à racheter » quand le stock courant ≤ seuil.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/logement-consommables?logement_id=` | Liste active + **stock courant** (dernier relevé) + `needs_restock` par item |
| POST | `/logement-consommables` | Crée un consommable (admin) — body `{ logement_id, label, unit?, seuil_alerte?, position? }` |
| PATCH | `/logement-consommables/:id` | Modifie la config (admin) — `label/unit/seuil_alerte/position` |
| PUT | `/logement-consommables/:id/stock` | **Fixe/initialise le stock courant** (admin) — body `{ qty }`. Crée un relevé manuel (`menage_id` NULL) qui devient le stock courant. Ne déclenche pas la notif de seuil. |
| DELETE | `/logement-consommables/:id` | Soft-delete via `archived_at` (admin) — préserve l'historique |
| GET | `/menages/:id/consommables` | Liste du logement + quantité relevée pour CE ménage (`qty` null si non saisi) |
| PUT | `/menages/:id/consommables` | Relevé au pointage de fin — body `{ items: [{ logement_consommable_id, qty }] }` (prestataire assigné ou admin) |

Chaque **logement** sérialisé (liste + détail) inclut `consommables_alert` (nombre de consommables sous le seuil) → badge « à racheter » côté dashboard/mobile.

## Menage views (badges « non-lus »)

Suivi des consultations par utilisateur pour afficher les badges de non-lus côté dashboard. Un « non-lu » = item créé après la dernière consultation de l'onglet, hors items de l'utilisateur. Seuls `comments`, `comments_steps`, `photos` sont comptés ; `documents`/`emergencies`/`emergencies_claim` renvoient toujours 0 (entités absentes).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menage-views/unread-summary` | Totaux : `{ by_menage: {id: n}, by_organization: {id: n} }` (scopé aux ménages visibles) |
| GET | `/menage-views/unread?menage_id=` | Compteurs détaillés d'un ménage (par onglet + `unread_step_ids`, `unread_emergency_ids`, `comments_last_viewed_at`). `comments_last_viewed_at` = dernière lecture de l'onglet discussion (null si jamais) → le client marque chaque commentaire postérieur comme non lu |
| POST | `/menage-views` | Marque un onglet comme lu — body `{ menage_id, tab }` → 204 |
| POST | `/menage-views/item` | Marque un item étape/urgence comme lu — body `{ item_type, item_id }` → 204 (no-op pour l'instant) |

Onglets (`tab`) : `comments`, `comments_steps`, `photos`, `documents`, `emergencies`, `emergencies_claim`.

---

## Notifications push (device tokens)

Enregistrement des tokens push Expo par appareil (multi-device). L'API envoie les push via l'API Push d'Expo (`https://exp.host`). Les tokens invalides (`DeviceNotRegistered`) sont purgés automatiquement.

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/device-tokens` | Enregistre/rafraîchit le token de l'appareil courant — body `{ token, platform? }`. Authentifié. Upsert sur `token`. |
| DELETE | `/device-tokens` | Désenregistre l'appareil (au logout) — body `{ token }`. Authentifié. → 204 |

**Événements déclenchant une push** :
- **Ménage assigné** → prestataire(s) nouvellement affecté(s) (`POST/PUT /menages/:id/prestataires`, `PATCH /menages/:id`, création `POST /menages` avec `prestataire_user_id`).
- **Nouveau ménage disponible** → prestataires membres du logement, quand un ménage est créé **sans** affectation (`POST /menages` **et** auto-création par sync iCal) → ils se positionnent présent/absent.
- **Ménage modifié** (date/horaire) → prestataires assignés (`PATCH /menages/:id`).
- **Ménage annulé** → prestataires assignés (`PATCH status=annule`, `DELETE /menages/:id`, **annulation par sync iCal**).
- **Ménage retiré** (désassignation) → prestataire retiré (`DELETE /menages/:id/prestataires/:user_id`, `PUT` full-replace, `PATCH` legacy).
- **Demande de report** → admins de l'org (`POST /reschedule-requests`).
- **Report accepté/refusé** → prestataire demandeur (`POST /reschedule-requests/:id/decide`).
- **Report annulé** → admins de l'org (`POST /reschedule-requests/:id/cancel`).
- **Réponse présent/absent** → admins de l'org (`POST /menages/:id/responses`, auto-réponse du presta).
- **Prestataire arrivé / ménage terminé** → admins de l'org (`POST /menages/:id/arrival` · `/departure`).
- **Ménage validé** → prestataires assignés (`POST /menages/:id/validate`).
- **Nouveau commentaire** → participants du ménage hors auteur (`POST /comments`).

- **Consommables à racheter** → admins de l'org, quand un relevé de fin passe des consommables sous le seuil (`PUT /menages/:id/consommables`).
- **Invitation acceptée** → l'inviteur, quand l'invité finalise son inscription (`POST /auth/register` avec `invitation_token`).

**Rappels programmés** (worker `reminder-worker`, tick 15 min, fuseau Europe/Paris ; anti-doublon via `menage.reminder_eve_sent_at` / `reminder_2h_sent_at`) :
- **Veille 18h** → prestataires assignés (« Demain · … ») ; si le ménage est **non assigné**, **relance** les prestataires du logement **non encore positionnés** (présent/absent).
- **2h avant** l'`horaire_prevu` → prestataires assignés.

Chaque notification embarque `data: { menage_id, type }` pour router vers le ménage au tap.

**Anti-abus** : rate-limit global 100 req/min/IP, + limites serrées sur les endpoints « bruyants » (`POST /comments` 20/min, `POST /menages/:id/responses` 30/min, `POST /reschedule-requests` 10/min), + limites **élargies** sur l'upload de photos (`POST /upload` et `POST /photos` 200/min, car un envoi groupé est légitime), + **throttle par destinataire** dans `sendPushToUsers` (max 8 push/min/user, fenêtre glissante en mémoire) pour qu'un abus ne noie pas la victime.

> **URLs de fichiers signées à la lecture** (token TTL 5 min, comme `/files`) : `avatar_url` (`/auth/me` + listes), `cover_photo_url` du logement (liste + détail), `photo_url` des pièces (`/logement-rooms`), `arrival_photo_url`/`departure_photo_url` du ménage (détail, liste, réponses pointage), et `url`/`thumbnail_url` des photos (`/photos`). Les URLs externes (ne contenant pas `/files/`) sont laissées intactes.

## Préférences de notifications

Chaque utilisateur peut couper certaines catégories de push. Par défaut tout est activé ; `sendPushToUsers` filtre les destinataires selon leur préférence pour la catégorie du `data.type`.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/notification-preferences` | État de chaque catégorie (`{ assignment: true, comments: false, … }`). Authentifié. |
| PATCH | `/notification-preferences` | Active/désactive une catégorie — body `{ key, enabled }`. |

Catégories : `assignment` (assigné/modifié/annulé/retiré), `available` (dispo + relances), `reminders` (rappels veille/2h), `reschedule` (reports), `presence` (présent/absent), `pointage` (arrivée/départ), `validation`, `comments`, `consumables`, `invitations`.

## Pages web (pont email → app)

Pages HTML publiques (pas d'API key) servant de relais depuis les emails : elles tentent d'ouvrir l'app via le deep link `estia-clean-connect://…` et proposent une retombée.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/invite/:token` | Page d'acceptation d'invitation (deep link `estia-clean-connect://invite/:token`). |
| GET | `/reset-password/:token` | Page de réinitialisation (deep link `estia-clean-connect://reset-password/:token`). |
| GET | `/assets/logo-estia.png` | Logo de marque (servi en statique, utilisé dans les emails). |

---

## Pages légales publiques

Pages HTML publiques (pas d'API key), référencées dans la fiche App Store / Play Store.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/privacy` | Politique de confidentialité (RGPD) — responsable de traitement EC CONCIERGERIE. |
| GET | `/support` | Page de support / contact. |

---

## Facturation (admin only, org-scoped)

Factures + devis regroupant des ménages d'un client (1 ligne/ménage, prix HT/TVA déjà sur le ménage). Génération par **ménages explicites** ou **client + période** (semaine/mois). Numérotation séquentielle légale (sans trou), attribuée à la finalisation. PDF via pdfkit. Anti double-facturation : un ménage déjà sur une facture non annulée est ignoré.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/invoices?type=&status=&client_id=` | Liste (factures + devis) |
| POST | `/invoices` | Génère un brouillon — body `{ client_id, type, period_start?, period_end?, menage_ids?, due_date?, notes? }` |
| GET | `/invoices/:id` | Facture + lignes |
| PATCH | `/invoices/:id` | `{ status?, due_date?, notes? }` — passage hors `draft` attribue le numéro |
| DELETE | `/invoices/:id` | Supprime (brouillon uniquement) |
| GET | `/invoices/:id/pdf` | PDF téléchargeable (facture/devis) |
| GET | `/invoices/export.csv?from=&to=` | Export comptable CSV (factures numérotées) |
| GET | `/invoices/provider-recap` | Montants à payer aux prestataires (ménages réalisés non payés, par presta) |
| POST | `/invoices/provider-payments` | Marque des ménages payés/non payés au presta — body `{ menage_ids, paid }` |

`type` : `invoice` (facture) \| `quote` (devis). `status` : `draft/sent/paid/cancelled` (facture), `draft/sent/accepted/refused` (devis).

## WebSocket

`GET /ws?token=<jwt>` — connexion temps réel.

Events poussés (JSON) :
- `comment.created/updated/deleted`
- `photo.created/deleted`
- `menage.arrival/departure/validated`
- `menage-check-item.toggled`

Format event :
```json
{
  "type": "menage.arrival",
  "menage_id": "uuid",
  "resource_id": "uuid (optional)",
  "actor_id": "uuid"
}
```

---

## Health

`GET /health` → `{ "status": "ok" }` (pas d'auth).
