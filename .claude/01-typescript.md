# TypeScript — Regles strictes

## Configuration

- `strict: true` dans tsconfig.json (ne jamais desactiver)
- Target : ES2022, module : commonjs

## Imports / Modules

- **ES modules uniquement** : `import`/`export`, jamais `require`/`module.exports`
- **Path aliases** : `@/*` pour `src/*`, `@tests/*` pour `tests/*`
- Pas d'import circulaire

## Typage

- Jamais de `any` — utiliser `unknown` avec type guard si necessaire
- Toujours typer les parametres et retours des fonctions publiques
- Deriver les types depuis Zod : `z.infer<typeof schema>`
- `readonly` pour les proprietes non reassignees

## Generics

- `BaseService<EntityRow>` — toujours passer le type Row
- Type narrowing avec `if (!item) return reply.notFound()`

## Enums

- Utiliser `as const` et `z.enum()` plutot que `enum` TypeScript
- Exemple : `const ROLES = ['admin', 'employee', 'client'] as const`

## Verification

- `npx tsc --noEmit` doit passer sans erreur avant chaque commit
