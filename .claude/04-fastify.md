# Fastify — Patterns

## Plugins

- Tous les modules utilisent `fastify-plugin` (fp) pour le scope global
- Auto-loading via `@fastify/autoload` depuis `src/modules/` (maxDepth: 1)

## Decorators

- `fastify.db` : instance Knex (plugin database)
- `fastify.authenticate` : preHandler JWT (plugin jwt)
- `request.user` : `{ sub: string; email: string }` (apres authenticate)

## Routes protegees

```typescript
fastify.get('/route', { preHandler: [fastify.authenticate] }, async (request) => {
  const userId = request.user.sub;
});
```

## Reponses

- Succes : retourner l'objet directement (JSON auto-serialise)
- Pagine : `{ data: T[], meta: { total, page, limit, totalPages } }`
- Erreurs : gerees par error-handler global, pas de try/catch
- Codes HTTP : 200 OK, 201 Created, 204 Deleted, 400 Validation, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict

## Erreurs metier

```typescript
throw Object.assign(new Error('Message'), { statusCode: 409 });
```

Ou utiliser les helpers sensible : `reply.notFound()`, `reply.badRequest()`
