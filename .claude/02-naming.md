# Conventions de nommage

| Element | Convention | Exemple |
|---|---|---|
| Table SQL | snake_case singulier | `user`, `chantier_member` |
| Colonne SQL | snake_case | `created_at`, `user_id`, `is_active` |
| FK | `<entite>_id` | `chantier_id`, `author_id` |
| Booleens | prefixe is/has/can | `is_active`, `can_edit` |
| Fichier module | kebab-case | `chantier-member.service.ts` |
| Fichier lib | kebab-case | `base-service.ts` |
| Classe | PascalCase | `ChantierService`, `CrudRouteBuilder` |
| Interface/Type | PascalCase | `UserRow`, `PaginatedResult` |
| Variable/Fonction | camelCase | `findByChantier()` |
| Constante | SCREAMING_SNAKE_CASE | `SALT_ROUNDS` |
| URL | kebab-case pluriel | `/chantiers`, `/chantier-members` |
| Plugin name | kebab-case + `-module` | `chantier-member-module` |

## Methodes

Exprimer l'intention, pas l'implementation :
- `findByEmail()` ✓ (pas `queryUserTableByEmail()`)
- `search()` ✓ (pas `executeSearchQuery()`)
