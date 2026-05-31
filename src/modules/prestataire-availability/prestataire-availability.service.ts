import { Knex } from 'knex';
import {
  PrestataireWeeklyAvailabilityRow,
  UpdateWeeklyAvailability,
} from './prestataire-availability.schema';

class PrestataireAvailabilityService {
  constructor(private db: Knex) {}

  /**
   * Renvoie la dispo hebdo du user dans l'org. Crée une ligne par défaut
   * (tout à false) si elle n'existe pas encore — comme ça l'UI a toujours
   * une valeur à afficher.
   */
  async findOrCreateForUser(
    userId: string,
    organizationId: string,
  ): Promise<PrestataireWeeklyAvailabilityRow> {
    const existing = (await this.db('prestataire_weekly_availability')
      .where({ user_id: userId, organization_id: organizationId })
      .first()) as PrestataireWeeklyAvailabilityRow | undefined;
    if (existing) return existing;

    const [created] = (await this.db('prestataire_weekly_availability')
      .insert({ user_id: userId, organization_id: organizationId })
      .returning('*')) as PrestataireWeeklyAvailabilityRow[];
    return created;
  }

  async updateForUser(
    userId: string,
    organizationId: string,
    data: UpdateWeeklyAvailability,
  ): Promise<PrestataireWeeklyAvailabilityRow> {
    // Upsert via onConflict pour l'idempotence (1er PATCH crée la ligne).
    const now = new Date();
    await this.db('prestataire_weekly_availability')
      .insert({ user_id: userId, organization_id: organizationId, ...data, updated_at: now })
      .onConflict(['user_id', 'organization_id'])
      .merge({ ...data, updated_at: now });

    return this.findOrCreateForUser(userId, organizationId);
  }

  async findByUserIds(
    organizationId: string,
    userIds: string[],
  ): Promise<PrestataireWeeklyAvailabilityRow[]> {
    if (userIds.length === 0) return [];
    return this.db('prestataire_weekly_availability')
      .where({ organization_id: organizationId })
      .whereIn('user_id', userIds) as Promise<PrestataireWeeklyAvailabilityRow[]>;
  }
}

export default PrestataireAvailabilityService;
