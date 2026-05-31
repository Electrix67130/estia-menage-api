# Clean Code — Principes

## Style

- **Early returns** (guard clauses) pour eviter le nesting
- `const` par defaut, `let` seulement si reassignation necessaire
- Destructurer les objets
- Pas de magic numbers/strings — extraire en constantes nommees
- Ternaires simples seulement (jamais imbriques)
- Max 3 parametres par fonction, au-dela utiliser un objet
- Fonctions courtes et focalisees (une chose)

## Async

- `async/await` partout, jamais `.then()/.catch()`
- `Promise.all()` pour les operations paralleles independantes

## Securite

- Knex parametre les requetes par defaut (safe SQL injection)
- Valider tous les inputs aux frontieres systeme avec Zod
- Ne jamais exposer `password_hash` dans les reponses API

## Performance

- Selectionner les colonnes specifiques quand possible
- Toujours paginer les listes
- `.clone()` avant de reutiliser un query builder Knex
