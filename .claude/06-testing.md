# Tests — Conventions

## Structure

```
tests/
├── unit/            # Tests unitaires (schemas, services)
├── integration/     # Tests d'integration (routes HTTP)
└── helpers/         # Utilitaires (buildApp, fixtures)
```

## Pattern AAA

1. **Arrange** : preparer les donnees
2. **Act** : executer l'action
3. **Assert** : verifier le resultat

## Regles

- Un assert par test quand possible
- Utiliser des fixtures, pas de donnees en dur
- Tester le comportement, pas l'implementation
- `afterAll` pour le cleanup
- Nommer les tests : `should <comportement attendu>`
