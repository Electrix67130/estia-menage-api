# Estia Menage API — Guidelines

> **Contexte produit complet (les 3 apps) :** @CONTEXT.md
> Lis-le pour comprendre le produit ; **mets-le à jour à chaque modification fonctionnelle**.

API REST pour la gestion de prestations de ménage Estia (logements locatifs + prestataires). Stack : **Fastify + Knex (PostgreSQL) + Zod + TypeScript**.

Entités principales : `logement` (bien paramétrable), `menage` (prestation datée), `menage_check_section/item` (checklist auto-générée), `logement_member` (permissions par logement), `photo` (horodatée), `comment`.

## Commandes

```bash
npm run dev              # Dev (tsx watch)
npm start                # Prod
npm run migrate          # Lancer les migrations
npm run migrate:make     # Creer une migration (ex: npm run migrate:make -- create_user)
npm run migrate:rollback # Rollback la derniere migration
npm run seed             # Lancer les seeds
npm run seed:make        # Creer un seed
npm test                 # Lancer les tests
```

## Architecture

```
src/
├── config/          # env.ts, knexfile.ts
├── lib/             # BaseService, CrudRouteBuilder (code generique)
├── migrations/      # Migrations Knex (fichiers horodates)
├── modules/         # Un dossier par entite (logement/, menage/, menage-check/, etc.)
│   └── <entity>/
│       ├── index.ts            # Registration Fastify (point d'entree du module)
│       ├── <entity>.service.ts # Service (extends BaseService)
│       └── <entity>.schema.ts  # Schemas Zod + types TS
├── plugins/         # Plugins Fastify (database, jwt, api-key, error-handler)
├── seeds/           # Seeds Knex
├── app.ts           # Configuration Fastify (plugins + autoload modules)
└── server.ts        # Point d'entree (listen)
docs/
├── API.md           # Reference des endpoints (pour le frontend)
└── MCD.md           # Schema de la BDD (MCD complet)
```

## Principes fondamentaux

- **Separation des couches** : Route (HTTP) -> Service (metier) -> BaseService (DB). Jamais de SQL dans les routes, jamais de HTTP dans les services.
- **Validation via Zod uniquement** dans les fichiers `.schema.ts`. Jamais dans les routes ou services.
- **Pas de try/catch dans les routes** : le error-handler global gere tout.
- **Logique metier dans le service**, routes = simples ponts HTTP.
- **Un fichier = une responsabilite** : schema, service, ou routes — jamais de mix.
- **TypeScript strict** : `strict: true`, jamais de `any`, typer les parametres et retours publics.
- **ES modules uniquement** : `import`/`export`, jamais `require`/`module.exports`.
- **Path aliases** : `@/*` pour `src/*`, `@tests/*` pour `tests/*`.

## Conventions de nommage

| Element | Convention | Exemple |
|---|---|---|
| Table BDD | snake_case singulier | `logement`, `logement_member`, `menage_check_section` |
| Colonne BDD | snake_case | `created_at`, `user_id`, `logement_id` |
| Classe | PascalCase | `LogementService`, `MenageService` |
| Methode | camelCase | `findByMenage()`, `createWithChecklist()` |
| URL | kebab-case pluriel | `/logements`, `/menages`, `/menage-check-items` |
| Fichier module | kebab-case | `logement-member.service.ts` |
| Plugin name | kebab-case + `-module` | `logement-member-module` |

## Pattern CRUD

### Schema (`<entity>.schema.ts`)
```typescript
export const createXxxSchema = z.object({ ... });
export const updateXxxSchema = z.object({ ... }); // tous les champs optional
export type CreateXxx = z.infer<typeof createXxxSchema>;
export type UpdateXxx = z.infer<typeof updateXxxSchema>;
export type XxxRow = { id: string; ... created_at: string; updated_at: string; };
```

### Service (`<entity>.service.ts`)
```typescript
class XxxService extends BaseService<XxxRow> {
  constructor(db: Knex) { super(db, 'xxx'); }
  // Methodes metier custom ici
}
```

### Routes (`index.ts`)
```typescript
export default fp((fastify, opts, done) => {
  const crud = new CrudRouteBuilder({ prefix, service, schemas, entityName });
  // Routes custom avant le CRUD
  crud.register(fastify, opts, done);
}, { name: 'xxx-module' });
```

### Migration
```javascript
exports.up = function (knex) {
  return knex.schema.createTable('xxx', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    // ... colonnes
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });
};
exports.down = function (knex) { return knex.schema.dropTable('xxx'); };
```

## Documentation — Regle obligatoire

**Toujours mettre a jour la documentation apres chaque modification.**

- **`.claude/CONTEXT.md`** : carte fonctionnelle des 3 apps — à mettre à jour à **chaque** modification fonctionnelle (feature, flux, déploiement/version)
- **`docs/API.md`** : chaque ajout/modification/suppression de route
- **`docs/MCD.md`** : chaque nouvelle migration
- **`.claude/`** : nouveaux patterns ou conventions

## Checklist nouveau module

1. Schema : `src/modules/<entity>/<entity>.schema.ts`
2. Service : `src/modules/<entity>/<entity>.service.ts`
3. Routes : `src/modules/<entity>/index.ts`
4. Migration : `npm run migrate:make -- create_<table>`
5. Doc API : mettre a jour `docs/API.md`
6. Doc MCD : mettre a jour `docs/MCD.md`
7. Verifier : `npx tsc --noEmit`
