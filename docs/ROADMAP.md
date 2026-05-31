# Roadmap — Estia Ménage

Liste des évolutions identifiées suite aux retours d'usage. Chaque item indique le scope (API / dashboard / ui), les changements de modèle de données et une estimation grossière.

Légende : 🔴 dépendance bloquante  ·  🟠 dépend mais découplable  ·  🟢 indépendant

---

## 1. Gestion des logements

### 1.1. Photos du logement (création + pièce par pièce) 🟢
- **Besoin** : pouvoir uploader des photos lors de la création d'un logement et en associer aux pièces (cuisine, salle de bain, chambre, etc.).
- **API**
  - Nouvelle table `logement_room` (`id`, `logement_id`, `name`, `position`, `created_at`).
  - Étendre `photo` : ajouter `logement_room_id` (nullable) en plus du lien existant à `logement_id`/`menage_id`. Une photo peut être taggée "logement", "pièce X" ou "menage".
  - Endpoints CRUD `logement-room` + upload de photo lié à une room.
- **Dashboard / UI** : section "Pièces & photos" dans la fiche logement, drag-and-drop ou bouton "+ photo" par pièce.
- **Estim.** : ~2-3 jours.

### 1.2. Check ménage paramétrable par logement 🟠 (dépend de 1.1 si on veut lier des items aux pièces)
- **Besoin** : la checklist auto-générée à la création d'un ménage doit pouvoir être personnalisée par logement (sections + items spécifiques au bien).
- **API**
  - Nouvelle table `logement_check_template_section` + `logement_check_template_item` (modèles attachés au logement).
  - Modifier la logique `MenageService.createWithChecklist` pour utiliser le template du logement si présent (fallback vers la checklist par défaut sinon).
- **Dashboard** : éditeur de template dans la fiche logement (drag-and-drop, ajout/suppression de sections et items).
- **Estim.** : ~3-4 jours.

---

## 2. Gestion des clients

### 2.1. Remplacer le "compte client" par une fiche client 🔴 (bloque 2.2 et tout le reste de la facturation)
- **Besoin** : un client n'a pas besoin de se connecter à l'app — c'est juste une fiche utilisée pour la facturation et l'organisation des logements. Le rôle `client` côté `user_role` peut rester pour les rares cas où on invite un client à voir, mais l'entité doit exister indépendamment.
- **API**
  - Nouvelle table `client` (`id`, `organization_id`, `first_name`, `last_name`, `company_name` nullable, `email` nullable, `phone` nullable, `billing_address`, `siret` nullable, `vat_number` nullable, `created_at`, `updated_at`).
  - Module `client` complet (schema/service/routes CRUD).
- **Dashboard** : nouvelle section "Clients" dans la sidebar, liste + fiche détaillée.
- **Estim.** : ~2 jours.

### 2.2. Un client → plusieurs logements 🔴 (dépend de 2.1)
- **Besoin** : rattacher plusieurs `logement` à une même `client`.
- **API** : ajouter `client_id` (FK nullable vers `client`) sur `logement`.
- **Dashboard** : sur la fiche logement → sélecteur "Client" ; sur la fiche client → liste des logements rattachés.
- **Estim.** : ~1 jour.

---

## 3. Gestion des prestations / ménages

### 3.1. Champs financiers sur le ménage 🟠 (utile pour 6.2, 7.2)
- **Besoin** : à la création d'un ménage, saisir le prix facturé au client (TTC ou HT à arbitrer) et le prix payé au prestataire.
- **Décision à prendre** : prix en TTC ou HT ? (impacte le calcul de marge, la facturation, les rapports légaux). Recommandation : stocker HT + TVA en pourcentage, calculer TTC à l'affichage.
- **API**
  - Migration `menage` : ajouter `client_price_ht` (decimal), `client_vat_rate` (decimal, défaut 20.00), `provider_price` (decimal), `currency` (string, défaut 'EUR').
  - Endpoint `GET /menages/:id` : ne PAS retourner `client_price_ht` ni `client_vat_rate` si le user est un prestataire (rôle employee non-admin). Filtrage à faire dans le service ou via un sérialiseur.
- **Dashboard** : champs prix dans le formulaire de création/édition de ménage.
- **UI (prestataire)** : afficher uniquement `provider_price`.
- **Estim.** : ~2 jours (dont test de l'access control).

### 3.2. Option "gestion du linge" 🟠 (idem 3.1, indépendant techniquement)
- **Besoin** : option booléenne "linge inclus" sur le ménage, avec deux champs de prix supplémentaires (facturé client, payé prestataire) pour cette option.
- **API**
  - Migration `menage` : ajouter `laundry_included` (bool), `laundry_client_price_ht` (decimal nullable), `laundry_provider_price` (decimal nullable).
  - Même règle d'access control que 3.1 pour le prix client.
- **Dashboard / UI** : toggle "Gestion du linge" + champs conditionnels.
- **Estim.** : ~1 jour si livré avec 3.1.

---

## 4. Affichage et ergonomie

### 4.1. Format de date FR 🟢
- **Besoin** : afficher les dates au format français (`DD/MM/YYYY`, parfois avec mois en lettres : "15 mai 2026").
- **UI** : utiliser `date-fns` avec la locale `fr` (déjà disponible) ou `Intl.DateTimeFormat('fr-FR')`. Centraliser dans un util `formatDate(date, variant)`.
- **Dashboard** : pareil, util partagé.
- **Estim.** : 0,5 jour.

### 4.2. Vue calendrier 🟢
- **Besoin** : vue mensuelle/hebdomadaire des ménages.
- **Dashboard** : ajouter onglet "Calendrier" avec lib type `react-big-calendar` ou `@fullcalendar/react`. Click sur un événement → ouverture du détail ménage.
- **UI mobile** : `react-native-calendars` ou équivalent.
- **Estim.** : ~2 jours (dashboard) + ~2 jours (mobile).

---

## 5. Espace prestataire (à tester davantage)

### 5.1. Validation arrivée / départ 🟢
- **Besoin** : le prestataire pointe son arrivée et son départ sur place.
- **API**
  - Migration `menage` : ajouter `arrived_at` (timestamp nullable), `departed_at` (timestamp nullable).
  - Endpoints `POST /menages/:id/arrive` et `POST /menages/:id/depart` (vérifie que l'user est bien assigné au ménage).
- **UI mobile** : 2 boutons gros sur l'écran ménage en cours.
- **Estim.** : ~1 jour.

### 5.2. Bilan des gains du prestataire 🟠 (dépend de 3.1)
- **Besoin** : écran "Mes gains" listant les ménages effectués + total sur la période.
- **API** : endpoint `GET /me/earnings?from=...&to=...` retournant la liste des ménages et la somme des `provider_price`.
- **UI mobile** : écran dédié dans le profil, avec filtre période.
- **Estim.** : ~1 jour.

### 5.3. Calendrier des prestations du prestataire 🟠 (lié à 4.2)
- **Besoin** : le prestataire voit son agenda de ménages à venir.
- **UI mobile** : réutilise la lib calendrier choisie en 4.2, filtré sur l'user connecté.
- **Estim.** : 0,5 jour si 4.2 fait.

### 5.4. Demande de changement de date 🟢
- **Besoin** : le prestataire peut demander à reporter une prestation (workflow d'acceptation côté admin/manager).
- **API**
  - Nouvelle table `menage_reschedule_request` (`id`, `menage_id`, `requested_by`, `proposed_start`, `proposed_end`, `reason`, `status` enum ['pending', 'approved', 'rejected'], `decided_by`, `decided_at`, `created_at`).
  - Endpoints `POST /menages/:id/reschedule-requests`, `PATCH /reschedule-requests/:id` (approve/reject).
  - Notif (push ou email) côté admin à la création, côté prestataire à la décision.
- **UI mobile** : bouton "Demander un changement" sur le ménage.
- **Dashboard** : section "Demandes en attente" avec accept/refuse.
- **Estim.** : ~2 jours.

---

## Ordre suggéré

1. **2.1 + 2.2** (fiche client + multi-logements) — base structurante pour la facturation.
2. **3.1 + 3.2** (prix + linge) — débloque 5.2 et la facturation.
3. **5.1** (pointage arrivée/départ) — gain rapide pour les prestataires.
4. **1.1 + 1.2** (photos + check paramétrable) — qualité de la prestation.
5. **4.1 + 4.2** (date FR + calendrier) — UX globale.
6. **5.2 + 5.3 + 5.4** (gains, agenda, reschedule) — espace prestataire complet.

## Décisions à arbitrer avant de coder

- **TTC ou HT côté `client_price`** ? Recommandation : HT + taux de TVA.
- **Devise** : on hardcode EUR ou on prépare le multi-devise ? (recommandation : champ `currency` mais hardcodé 'EUR' tant qu'une seule).
- **Le rôle `client` existe-t-il toujours dans `user_role`** après 2.1 ? À garder pour les rares cas où on invite un client à voir, ou supprimer ?
- **Notif prestataire** : push (Expo Notifications) ou email pour les demandes de reschedule ?
