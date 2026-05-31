/**
 * Rattrapage : crée une ligne dans `client` (facturation) pour chaque user
 * existant avec role='client' qui n'a pas encore d'équivalent (matché par email
 * dans la même organisation).
 *
 * À partir de cette migration, l'auth.service crée automatiquement la ligne
 * `client` lors de l'inscription d'un user role='client' (cf. registerService).
 */
exports.up = async function (knex) {
  // 1. Récupère tous les users role='client' avec leur org active.
  const clientUsers = await knex('user as u')
    .join('organization_member as om', 'om.user_id', 'u.id')
    .where('om.role', 'client')
    .select(
      'u.id as user_id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.phone',
      'u.company_name',
      'om.organization_id',
    );

  for (const cu of clientUsers) {
    // Skip si une ligne client existe déjà pour ce couple (org, email).
    if (cu.email) {
      const existing = await knex('client')
        .where({ organization_id: cu.organization_id, email: cu.email })
        .whereNull('archived_at')
        .first();
      if (existing) continue;
    }

    await knex('client').insert({
      organization_id: cu.organization_id,
      created_by: cu.user_id,
      first_name: cu.first_name,
      last_name: cu.last_name,
      company_name: cu.company_name,
      email: cu.email,
      phone: cu.phone,
      country: 'FR',
    });
  }
};

exports.down = async function (_knex) {
  // Pas de rollback : impossible d'identifier proprement les lignes créées
  // par cette migration sans colonne dédiée. Si rollback nécessaire,
  // gérer manuellement.
};
