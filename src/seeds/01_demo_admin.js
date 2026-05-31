const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const DEMO_PASSWORD = 'test1234';

const USERS = [
  {
    email: 'admin@menage.fr',
    first_name: 'Admin',
    last_name: 'Estia',
    role: 'admin',
    phone: '+33600000001',
  },
  {
    email: 'manager@menage.fr',
    first_name: 'Marie',
    last_name: 'Dupont',
    role: 'prestataire',
    phone: '+33600000002',
  },
  {
    email: 'employee@menage.fr',
    first_name: 'Paul',
    last_name: 'Martin',
    role: 'prestataire',
    phone: '+33600000003',
  },
];

const ORG_NAME = 'Estia Demo';

/**
 * Seed idempotent : UPSERT plutôt que wipe + insert.
 *
 * L'ancienne version supprimait l'org et les users existants, mais
 * `organization` est cible de FK (photo.uploaded_by → user, plus toute la
 * chaîne menage/logement/...) et la suppression échoue dès qu'il y a de la
 * donnée. Avant l'échec, la table `organization_member` était déjà vidée,
 * laissant tout le monde sans membership → 403 partout.
 *
 * Cette version :
 *  1. Crée l'org si absente (sinon réutilise).
 *  2. Crée chaque user s'il n'existe pas (sinon réutilise / sync minimal).
 *  3. Garantit la présence des organization_member pour les comptes demo.
 *
 * Tout reste réversible : il suffit de relancer `npm run seed` autant de fois
 * qu'on veut.
 */
exports.seed = async function (knex) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);

  // 1. Org (upsert by name)
  let org = await knex('organization').where({ name: ORG_NAME }).first();
  if (!org) {
    const [created] = await knex('organization')
      .insert({ name: ORG_NAME, country: 'FR' })
      .returning('id');
    org = { id: created.id };
  }
  const organizationId = org.id;

  // 2. Users (upsert by email) + organization_member présent
  for (const u of USERS) {
    let user = await knex('user').where({ email: u.email }).first();
    if (!user) {
      const [created] = await knex('user')
        .insert({
          email: u.email,
          password_hash: passwordHash,
          first_name: u.first_name,
          last_name: u.last_name,
          phone: u.phone,
          role: u.role,
          company_name: ORG_NAME,
          organization_id: organizationId,
          active_organization_id: organizationId,
        })
        .returning(['id', 'email', 'role']);
      user = created;
    } else {
      // Sync minimal : remet le hash + l'active_organization_id si dérivés.
      await knex('user').where({ id: user.id }).update({
        password_hash: passwordHash,
        role: u.role,
        active_organization_id: organizationId,
      });
    }

    // membership (org_id, user_id) — INSERT ... ON CONFLICT DO UPDATE
    await knex('organization_member')
      .insert({ organization_id: organizationId, user_id: user.id, role: u.role })
      .onConflict(['organization_id', 'user_id'])
      .merge({ role: u.role });
  }

  // 3. organization.created_by = admin (si pas déjà défini)
  const admin = await knex('user').where({ email: 'admin@menage.fr' }).first();
  if (admin) {
    await knex('organization')
      .where({ id: organizationId })
      .whereNull('created_by')
      .update({ created_by: admin.id });
  }

  console.log(`Seeded ${USERS.length} demo users (password: ${DEMO_PASSWORD}) in org "${ORG_NAME}"`);
};
