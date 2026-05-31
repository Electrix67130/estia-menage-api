# Patterns avances

## Relations (FK)

```typescript
async findByChantier(chantierId: string, pagination: PaginationOptions) {
  // Filtrer + paginer
}
```

## Jointures

```typescript
const data = await this.db(this.table)
  .join('user', 'comment.author_id', 'user.id')
  .select('comment.*', 'user.first_name', 'user.last_name')
  .where('comment.chantier_id', chantierId);
```

## Soft delete

```typescript
// Filtrer les suppresses dans findAll
async findAll(opts) {
  // Ajouter .whereNull('deleted_at') au query
}
```

## Recherche GPS (Haversine)

```typescript
const haversine = `
  6371 * acos(
    cos(radians(?)) * cos(radians(latitude)) *
    cos(radians(longitude) - radians(?)) +
    sin(radians(?)) * sin(radians(latitude))
  )
`;
// Utiliser dans .whereRaw() et .orderByRaw()
```

## Transactions

```typescript
await this.db.transaction(async (trx) => {
  await trx('table1').insert(data1);
  await trx('table2').insert(data2);
});
```
