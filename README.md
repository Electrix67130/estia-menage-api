# Estia Ménage — API

API REST pour la gestion de prestations de ménage Estia (logements locatifs courte durée + prestataires). Backend des applications [mobile](https://github.com/Electrix67130/estia-menage-ui) et [dashboard](https://github.com/Electrix67130/estia-menage-dashboard).

## Stack

- **Fastify** (HTTP server)
- **Knex** + **PostgreSQL** (migrations + queries)
- **Zod** (validation des entrées)
- **TypeScript** strict, ES modules
- **JWT** (auth multi-plateforme, sessions par device)
- **Docker** + **Docker Compose** (dev + prod)

## Démarrage rapide

Prérequis : Docker Desktop, Node 20+.

```bash
cp .env.example .env             # configure les variables d'environnement
docker-compose up -d              # lance postgres + l'API
docker exec estia-menage-api npm run migrate    # applique les migrations
docker exec estia-menage-api npm run seed       # crée un admin de démo
```

Comptes de démo (`password: test1234`) :
- `admin@menage.fr` (admin)
- `manager@menage.fr` / `employee@menage.fr` (prestataires)

API dispo sur `http://localhost:3000`.

## Architecture

```
src/
├── config/          env.ts, knexfile.ts
├── lib/             BaseService, CrudRouteBuilder (code générique)
├── migrations/      Migrations Knex
├── modules/         Un dossier par entité métier
│   └── <entity>/
│       ├── index.ts            # routes Fastify
│       ├── <entity>.service.ts # logique métier (extends BaseService)
│       └── <entity>.schema.ts  # schémas Zod + types TS
├── plugins/         Plugins Fastify (database, jwt, error-handler…)
├── seeds/           Seeds Knex
├── app.ts           Configuration Fastify
└── server.ts        Point d'entrée
docs/
├── API.md           Référence des endpoints (pour le frontend)
└── MCD.md           Schéma de la base de données
```

## Scripts npm

| Commande | Description |
|---|---|
| `npm run dev` | Dev avec rechargement (tsx watch) |
| `npm start` | Prod |
| `npm run migrate` | Lance les migrations en attente |
| `npm run migrate:make -- <name>` | Crée un fichier de migration |
| `npm run migrate:rollback` | Rollback la dernière migration |
| `npm run seed` | Lance les seeds (idempotent) |
| `npm test` | Tests Jest |

## Principes

- Séparation des couches : route (HTTP) → service (métier) → BaseService (DB). Aucune requête SQL dans les routes.
- Validation **exclusivement via Zod** dans les fichiers `.schema.ts`.
- Pas de `try/catch` dans les routes : un error-handler global gère tout.
- Pas de `any` ; types de retour publics annotés.

## Documentation

- **[docs/API.md](docs/API.md)** — liste exhaustive des endpoints.
- **[docs/MCD.md](docs/MCD.md)** — modèle conceptuel de données.
- **[.claude/CLAUDE.md](.claude/CLAUDE.md)** — guidelines projet.

## Repos liés

- 📱 [estia-menage-ui](https://github.com/Electrix67130/estia-menage-ui) — app mobile (Expo / React Native).
- 🖥️ [estia-menage-dashboard](https://github.com/Electrix67130/estia-menage-dashboard) — admin (Next.js).
- 🌐 [estia-menage-website](https://github.com/Electrix67130/estia-menage-website) — site vitrine.
