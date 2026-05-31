# Estia Menage API

API REST pour la gestion de prestations de ménage Estia (logements locatifs courte durée, prestataires, validation de rapports).

**Stack** : Fastify + Knex (PostgreSQL) + Zod + TypeScript

## Démarrage rapide

### 1. Pré-requis

- Node.js ≥ 20
- PostgreSQL 14+
- Docker / Docker Compose (recommandé pour la BDD)

### 2. Installation

```bash
npm install
cp .env.example .env
# édite .env avec tes credentials BDD, JWT secret, etc.
```

### 3. Base de données

```bash
docker compose up -d           # démarre Postgres
npm run migrate                # applique les migrations
npm run seed                   # optionnel — données de démo
```

### 4. Lancer l'API

```bash
npm run dev      # mode dev (tsx watch)
npm start        # production
```

L'API écoute sur `http://localhost:3000` par défaut.

## Commandes

| Commande | Description |
|---|---|
| `npm run dev` | Dev avec hot-reload (tsx watch) |
| `npm start` | Run en production |
| `npm run build` | Compile TS → dist |
| `npm run migrate` | Applique les migrations Knex |
| `npm run migrate:make -- <name>` | Crée une nouvelle migration |
| `npm run migrate:rollback` | Rollback la dernière migration |
| `npm run seed` | Lance les seeds |
| `npm test` | Lance les tests (Jest) |

## Architecture

```
src/
├── config/          # env.ts, knexfile
├── lib/             # BaseService, CrudRouteBuilder, permissions
├── migrations/      # Migrations Knex (horodatées)
├── modules/         # Un dossier par entité métier
│   ├── auth/
│   ├── user/
│   ├── organization/
│   ├── organization-member/
│   ├── invitation/
│   ├── logement/             # Bien locatif paramétrable
│   ├── menage/               # Prestation de ménage datée
│   ├── logement-member/      # Permissions par logement
│   ├── menage-check/         # Checklist par pièce
│   ├── photo/
│   └── comment/
├── plugins/         # Plugins Fastify (db, jwt, error-handler, upload, websocket)
├── seeds/           # Seeds Knex
├── app.ts           # Configuration Fastify (plugins + autoload modules)
└── server.ts        # Point d'entrée
```

### Principes

- **Séparation des couches** : Route (HTTP) → Service (métier) → BaseService (DB). Jamais de SQL dans les routes.
- **Validation via Zod** uniquement, dans les fichiers `.schema.ts`.
- **Pas de try/catch dans les routes** : un error-handler global les gère.
- **TypeScript strict**, jamais de `any`.

## Domaine métier

- **Logement** : bien locatif paramétrable (nb chambres, salles de bain, WC, cuisines, etc.). Source des paramètres pour générer les checklists.
- **Ménage** : prestation datée rattachée à un logement et assignée à un prestataire. Statuts : `a_venir → en_cours → termine → valide`.
- **Checklist** : générée automatiquement à la création du ménage à partir des paramètres du logement. Composée de **sections** (= pièces) contenant des **items** validables.
- **Validation rapport** : le manager valide chaque ménage terminé et peut ajuster le prix (ex: majoration si logement très sale).
- **Permissions** : `logement_member` (manager / prestataire / client_proprietaire) + `menage.prestataire_user_id` (assignation ponctuelle).

## Documentation

- **[`docs/API.md`](docs/API.md)** — Référence complète des endpoints (pour le frontend)
- **[`docs/MCD.md`](docs/MCD.md)** — Modèle de données (tables, relations, contraintes)
- **[`.claude/`](.claude/)** — Guides détaillés (TypeScript, naming, CRUD pattern, Fastify, clean code, tests)

## Auth

JWT (access + refresh tokens). Endpoints :

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

Les routes protégées requièrent `Authorization: Bearer <access_token>`.

## Future Phases (hors scope MVP)

Reportées à une V2 :

- Calendrier (vue Airbnb : par logement / par prestataire / global)
- Espace ADMIN (statistiques, facturation client, bilan paiements prestataires)
- Notifications SMS (Twilio / OVH)
- Photos d'exemple par cadrage (style PassPass)
- Déclaration de litiges
- Multi-prestataires par ménage
- Push notifications (Expo)
- Templates de checklist éditables en base
