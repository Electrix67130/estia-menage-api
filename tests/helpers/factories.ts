import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

/** Mot de passe commun à tous les comptes de test. */
export const TEST_PASSWORD = 'MotDePasse123!';

// Deux économies, car chaque compte de test se connecte pour de vrai.
//
// Le condensat n'est calculé qu'une fois pour toute la suite : tous les comptes
// partagent le même mot de passe. Et il l'est avec un coût de 4 au lieu de 10 —
// c'est le coût inscrit DANS le condensat qui détermine le prix de
// `bcrypt.compare` à chaque connexion, soit quelques millisecondes au lieu de
// centaines. La production continue de hacher à son coût normal.
const TEST_BCRYPT_COST = 4;
let sharedHash: string | null = null;

async function passwordHash(): Promise<string> {
  if (!sharedHash) sharedHash = await bcrypt.hash(TEST_PASSWORD, TEST_BCRYPT_COST);
  return sharedHash;
}

let emailCounter = 0;
function nextEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}${emailCounter}@test.local`;
}

export interface TestUser {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  /** Jeton d'accès obtenu par un vrai POST /auth/login. */
  token: string;
}

/** Crée une organisation et renvoie son identifiant. */
export async function createOrganization(app: FastifyInstance, name: string): Promise<string> {
  const [org] = await app.db('organization').insert({ name }).returning('id');
  return org.id as string;
}

/**
 * Crée un utilisateur rattaché à une organisation avec un rôle donné, puis
 * l'authentifie.
 *
 * L'insertion est directe en base — construire chaque compte via l'API
 * demanderait une invitation par utilisateur et rendrait les tests dépendants
 * du parcours qu'ils sont parfois censés vérifier. La connexion, elle, passe
 * bien par l'API : c'est le jeton réel qui est testé.
 */
export async function createUser(
  app: FastifyInstance,
  params: { organizationId: string; role: 'admin' | 'prestataire'; email?: string },
): Promise<TestUser> {
  const email = params.email ?? nextEmail(params.role);
  const [user] = await app
    .db('user')
    .insert({
      email,
      password_hash: await passwordHash(),
      first_name: 'Test',
      last_name: params.role,
      phone: '0600000000',
      role: params.role,
      organization_id: params.organizationId,
      active_organization_id: params.organizationId,
    })
    .returning('id');

  await app.db('organization_member').insert({
    organization_id: params.organizationId,
    user_id: user.id,
    role: params.role,
  });

  const token = await login(app, email);

  return {
    id: user.id as string,
    email,
    role: params.role,
    organizationId: params.organizationId,
    token,
  };
}

/** Crée une organisation et son administrateur d'un coup. */
export async function createOrgWithAdmin(
  app: FastifyInstance,
  name: string,
): Promise<{ organizationId: string; admin: TestUser }> {
  const organizationId = await createOrganization(app, name);
  const admin = await createUser(app, { organizationId, role: 'admin' });
  return { organizationId, admin };
}

/**
 * Crée un super admin : un compte ordinaire, plus le drapeau qui ouvre la
 * console. En production ce drapeau est posé à la main en SQL, il n'existe
 * aucune route pour l'accorder.
 */
export async function createSuperAdmin(
  app: FastifyInstance,
  organizationId: string,
): Promise<TestUser> {
  const compte = await createUser(app, { organizationId, role: 'admin' });
  await app.db('user').where({ id: compte.id }).update({ is_super_admin: true });
  return compte;
}

/** Crée un logement dans une organisation. */
export async function createLogement(
  app: FastifyInstance,
  params: { organizationId: string; createdBy: string; name?: string },
): Promise<string> {
  const [row] = await app
    .db('logement')
    .insert({
      organization_id: params.organizationId,
      created_by: params.createdBy,
      name: params.name ?? 'Logement de test',
    })
    .returning('id');
  return row.id as string;
}

/** Rattache un utilisateur à un logement avec un rôle et des permissions. */
export async function addLogementMember(
  app: FastifyInstance,
  params: {
    logementId: string;
    userId: string;
    role?: 'manager' | 'prestataire' | 'client_proprietaire';
    canViewClients?: boolean;
  },
): Promise<void> {
  await app.db('logement_member').insert({
    logement_id: params.logementId,
    user_id: params.userId,
    role: params.role ?? 'prestataire',
    can_view_clients: params.canViewClients ?? false,
  });
}

/** Crée une prestation, éventuellement affectée à un prestataire. */
export async function createMenage(
  app: FastifyInstance,
  params: {
    logementId: string;
    organizationId: string;
    createdBy: string;
    prestataireUserId?: string | null;
    datePrevue?: string;
    status?: string;
  },
): Promise<string> {
  const [row] = await app
    .db('menage')
    .insert({
      logement_id: params.logementId,
      organization_id: params.organizationId,
      created_by: params.createdBy,
      prestataire_user_id: params.prestataireUserId ?? null,
      date_prevue: params.datePrevue ?? '2026-07-01',
      status: params.status ?? 'a_venir',
    })
    .returning('id');
  const menageId = row.id as string;
  // L'affectation vit dans `menage_prestataire` ; `menage.prestataire_user_id`
  // ne désigne que le référent. Les deux doivent être cohérentes — `is_primary`
  // n'est pas une colonne, il est calculé à la lecture (premier par date).
  if (params.prestataireUserId) {
    await app.db('menage_prestataire').insert({
      menage_id: menageId,
      user_id: params.prestataireUserId,
    });
  }
  return menageId;
}

/** Authentifie un compte de test et renvoie son jeton d'accès. */
export async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: TEST_PASSWORD, platform: 'web' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Connexion impossible pour ${email} : ${res.statusCode} ${res.body}`);
  }
  return res.json().access_token as string;
}
