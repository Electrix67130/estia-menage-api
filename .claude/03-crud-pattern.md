# Pattern CRUD — Template obligatoire

## 1. Schema (`<entity>.schema.ts`)

```typescript
import { z } from 'zod';

export const createXxxSchema = z.object({ ... });
export const updateXxxSchema = z.object({ ... }); // tous optional
export type CreateXxx = z.infer<typeof createXxxSchema>;
export type UpdateXxx = z.infer<typeof updateXxxSchema>;
export type XxxRow = { id: string; ... created_at: string; updated_at: string; };
```

- Ne jamais inclure `id`, `created_at`, `updated_at` dans les schemas
- Update = tous les champs optional (PATCH semantics)

## 2. Service (`<entity>.service.ts`)

```typescript
class XxxService extends BaseService<XxxRow> {
  constructor(db: Knex) { super(db, 'xxx'); }
}
```

- Ne pas redefinir findAll/findById/create/update/delete sauf besoin metier
- Methodes custom : `findByChantier()`, `search()`, etc.

## 3. Routes (`index.ts`)

```typescript
export default fp((fastify, opts, done) => {
  const crud = new CrudRouteBuilder({
    prefix: '/xxxs',
    service: (f) => new XxxService(f.db),
    schemas: { create: createXxxSchema, update: updateXxxSchema },
    entityName: 'Xxx',
  });
  // Routes custom AVANT le CRUD si meme prefix
  crud.register(fastify, opts, done);
}, { name: 'xxx-module' });
```

## 4. Migration

```javascript
exports.up = function (knex) {
  return knex.schema.createTable('xxx', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    // colonnes...
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });
};
exports.down = function (knex) {
  return knex.schema.dropTable('xxx');
};
```

- FK : `.references('id').inTable('xxx').onDelete('CASCADE')`
- `down` doit exactement inverser `up`
