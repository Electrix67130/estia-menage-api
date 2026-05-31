import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { CreateOrganization, OrganizationRow } from './organization.schema';

class OrganizationService extends BaseService<OrganizationRow> {
  constructor(db: Knex) {
    super(db, 'organization');
  }

  async findByUser(userId: string): Promise<OrganizationRow | undefined> {
    const user = await this.db('user').where({ id: userId }).select('active_organization_id').first();
    if (!user?.active_organization_id) return undefined;
    return this.db(this.table).where({ id: user.active_organization_id }).first() as Promise<
      OrganizationRow | undefined
    >;
  }

  /** Cree une org + une membership admin pour le createur, set comme org active. Transactionnel. */
  async createWithAdmin(
    data: CreateOrganization,
    createdByUserId: string,
  ): Promise<OrganizationRow> {
    return this.db.transaction(async (trx) => {
      const insertRow: Record<string, unknown> = { name: data.name, created_by: createdByUserId };
      // On copie uniquement les valeurs définies pour ne pas écraser les defaults SQL avec null inutile.
      for (const [key, value] of Object.entries(data)) {
        if (key === 'name') continue;
        if (value === undefined) continue;
        insertRow[key] = value;
      }
      const [org] = await trx('organization').insert(insertRow).returning('*');
      await trx('organization_member').insert({
        organization_id: org.id,
        user_id: createdByUserId,
        role: 'admin',
      });
      await trx('user')
        .where({ id: createdByUserId })
        .update({ active_organization_id: org.id });
      return org as OrganizationRow;
    });
  }
}

export default OrganizationService;
