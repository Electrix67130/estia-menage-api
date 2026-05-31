/**
 * Backfill : pour chaque logement existant, génère les pièces manquantes selon
 * ses counts (n_bedrooms, n_bathrooms, etc.). Idempotent — un re-run ne
 * dupliquera rien (on respecte le compte cible par kind).
 *
 * Cette migration reproduit la logique de LogementRoomService.generateForLogement
 * en SQL/JS plain — on évite l'import du service compilé en TS pour rester
 * Node-only et compatible avec n'importe quel environnement.
 */
const COUNT_FIELDS = [
  { field: 'n_bedrooms', kind: 'chambre', singular: 'Chambre' },
  { field: 'n_bathrooms', kind: 'salle_de_bain', singular: 'Salle de bain' },
  { field: 'n_wc', kind: 'wc', singular: 'WC' },
  { field: 'n_kitchens', kind: 'cuisine', singular: 'Cuisine' },
  { field: 'n_living_rooms', kind: 'salon', singular: 'Salon' },
  { field: 'n_exterior_spaces', kind: 'exterieur', singular: 'Extérieur' },
];

const FLAG_ROOMS = [
  { field: 'has_basement', kind: 'cave', singular: 'Cave' },
  { field: 'has_laundry', kind: 'buanderie', singular: 'Buanderie' },
];

exports.up = async function (knex) {
  const logements = await knex('logement').select(
    'id',
    'n_bedrooms',
    'n_bathrooms',
    'n_wc',
    'n_kitchens',
    'n_living_rooms',
    'n_exterior_spaces',
    'has_basement',
    'has_laundry',
  );

  for (const l of logements) {
    const existing = await knex('logement_room')
      .where({ logement_id: l.id })
      .select('kind', 'position');

    const byKind = new Map();
    for (const r of existing) {
      if (!r.kind) continue;
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    }
    let nextPos = existing.length;
    const toInsert = [];

    for (const cf of COUNT_FIELDS) {
      const target = l[cf.field] ?? 0;
      const already = byKind.get(cf.kind) ?? 0;
      const missing = Math.max(0, target - already);
      for (let i = 0; i < missing; i++) {
        const idx = already + i + 1;
        const name = target === 1 && already === 0 ? cf.singular : `${cf.singular} ${idx}`;
        toInsert.push({
          logement_id: l.id,
          name,
          kind: cf.kind,
          position: nextPos++,
        });
      }
    }

    for (const ff of FLAG_ROOMS) {
      if (!l[ff.field]) continue;
      if ((byKind.get(ff.kind) ?? 0) > 0) continue;
      toInsert.push({
        logement_id: l.id,
        name: ff.singular,
        kind: ff.kind,
        position: nextPos++,
      });
    }

    if (toInsert.length > 0) {
      await knex('logement_room').insert(toInsert);
    }
  }
};

exports.down = async function (_knex) {
  // Pas de rollback : impossible d'identifier proprement les rows créées par
  // cette migration. Si rollback nécessaire, intervention manuelle.
};
