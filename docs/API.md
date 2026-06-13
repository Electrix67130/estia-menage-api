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
| PATCH | `/users/:id` | Édite son propre profil (ou admin pour role/is_active) |
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
| POST | `/invitations` | Crée invitation (admin) |
| GET | `/invitations/by-token?token=` | Vérifie un token |
| POST | `/invitations/accept` | Accepte invitation (lors de register) |

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

---

## Logement room

Pièces du logement (chambre, salle de bain, etc). Permet d'attacher des photos par pièce et de construire un template de checklist par pièce.

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
  "name": "Chambre parentale",
  "kind": "chambre",
  "position": 0,
  "notes": "Lit king size"
}
```

`kind` ∈ `chambre, salle_de_bain, wc, cuisine, salon, salle_a_manger, bureau, entree, couloir, exterieur, cave, buanderie, autre`.

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

## Menage

Prestation de ménage datée, FK logement + prestataire.

Chaque ménage sérialisé (liste **et** détail) inclut un booléen calculé **`needs_attention`** : `true` quand le jour prévu est passé, qu'aucun pointage d'arrivée n'a été enregistré (`arrived_at` vide) et que le statut est encore `a_venir`. Sert à mettre le ménage en évidence (badge « Non pointé » + carte surlignée) côté dashboard et mobile.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menages?status=&prestataire_user_id=&logement_id=&validated=&unassigned=&manager=me&from=&to=` | Liste filtrable. Chaque ménage inclut un booléen `has_pending_reschedule` (true s'il existe au moins une `menage_reschedule_request` `status='pending'`) — sert à afficher un badge "demande en attente" sur les cards admin. |
| GET | `/menages/:id` | Détail (inclut aussi `has_pending_reschedule`). |
| GET | `/menages/:id/eligible-prestataires` | **Tous** les prestataires de l'org, avec un flag `is_member` (membre prestataire du logement). Les non-membres peuvent être affectés **ponctuellement** (remplacement) — ils ne reçoivent que ce ménage |
| POST | `/menages` | Création (admin) — **génère auto la checklist** |
| PATCH | `/menages/:id` | Mise à jour (manager/admin via can_edit) — accepte `prestataire_user_id` pour affecter/désaffecter. Si on modifie `date_prevue` sur un ménage rattaché à un calendrier externe, `date_locked` est posé à `true` automatiquement (sauf si le payload contient une valeur explicite de `date_locked`, par ex. `date_locked: false` pour rouvrir le ménage à la sync iCal). |
| DELETE | `/menages/:id` | Suppression (admin) |
| POST | `/menages/:id/arrival` | Pointage arrivée (prestataire assigné) — body `{ photo_url, lat, lng }` (photo géolocalisée obligatoire) |
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
- `n_lit_simple` / `n_lit_double` / `n_canape_lit` / `n_lit_appoint` (int 0-50, optionnel) — si non fournis, copiés depuis le logement parent. Modifiables ensuite via `PATCH /menages/:id` (admin uniquement, lecture seule côté prestataire).

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
| POST | `/menage-check-items` | Ajout item |
| PATCH | `/menage-check-items/:id` | Modifie item (label, comment) |
| DELETE | `/menage-check-items/:id` | Supprime item |
| POST | `/menage-check-sections/:id/items/reorder` | Body `{ ordered_ids: [...] }` |
| POST | `/menage-check-items/:id/toggle` | Valide/dévalide item — body `{ validated: bool, comment?: string }` |

Types de section : `kitchen, living_room, bedroom, bathroom, wc, exterior, basement, laundry, general`.

Le toggle est accessible au **prestataire assigné** du ménage OU à toute personne avec `can_edit` sur le logement.

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

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/photos?menage_id=` | Photos du ménage (requiert `view_photos`) |
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

---

## Upload de fichiers

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/upload` | Upload multipart (champ fichier). Authentifié. Max 10 Mo. |
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

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/comments?menage_id=&section_id=` | Liste (section_id='general' pour hors-section) |
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
| PATCH | `/logement-consommables/:id` | Modifie (admin) |
| DELETE | `/logement-consommables/:id` | Soft-delete via `archived_at` (admin) — préserve l'historique |
| GET | `/menages/:id/consommables` | Liste du logement + quantité relevée pour CE ménage (`qty` null si non saisi) |
| PUT | `/menages/:id/consommables` | Relevé au pointage de fin — body `{ items: [{ logement_consommable_id, qty }] }` (prestataire assigné ou admin) |

Chaque **logement** sérialisé (liste + détail) inclut `consommables_alert` (nombre de consommables sous le seuil) → badge « à racheter » côté dashboard/mobile.

## Menage views (badges « non-lus »)

Suivi des consultations par utilisateur pour afficher les badges de non-lus côté dashboard. Un « non-lu » = item créé après la dernière consultation de l'onglet, hors items de l'utilisateur. Seuls `comments`, `comments_steps`, `photos` sont comptés ; `documents`/`emergencies`/`emergencies_claim` renvoient toujours 0 (entités absentes).

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/menage-views/unread-summary` | Totaux : `{ by_menage: {id: n}, by_organization: {id: n} }` (scopé aux ménages visibles) |
| GET | `/menage-views/unread?menage_id=` | Compteurs détaillés d'un ménage (par onglet + `unread_step_ids`, `unread_emergency_ids`) |
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
- **Ménage assigné** → prestataire(s) nouvellement affecté(s) (`POST/PUT/POST /menages/:id/prestataires`, `PATCH /menages/:id`, création `POST /menages` avec `prestataire_user_id`).
- **Nouveau ménage disponible** → prestataires membres du logement, quand un ménage est créé **sans** affectation (`POST /menages`) → ils se positionnent présent/absent.
- **Demande de report** → admins de l'organisation (`POST /reschedule-requests`).
- **Réponse au report** (acceptée/refusée) → prestataire demandeur (`POST /reschedule-requests/:id/decide`).
- **Nouveau commentaire** → participants du ménage hors auteur (`POST /comments`).

Chaque notification embarque `data: { menage_id, type }` pour router vers le ménage au tap.

> **Avatars** : `avatar_url` est signé à la lecture (token TTL 5 min, comme `/files`) dans `/auth/me` et toutes les listes exposant un avatar. Les avatars externes (URL ne contenant pas `/files/`) sont laissés intacts.

## Pages web (pont email → app)

Pages HTML publiques (pas d'API key) servant de relais depuis les emails : elles tentent d'ouvrir l'app via le deep link `estia-clean-connect://…` et proposent une retombée.

| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/invite/:token` | Page d'acceptation d'invitation (deep link `estia-clean-connect://invite/:token`). |
| GET | `/reset-password/:token` | Page de réinitialisation (deep link `estia-clean-connect://reset-password/:token`). |
| GET | `/assets/logo-estia.png` | Logo de marque (servi en statique, utilisé dans les emails). |

---

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
