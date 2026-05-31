import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { ClientRow } from './client.schema';

interface ReportMenageRaw {
  id: string;
  date_prevue: string;
  date_realisation: string | null;
  horaire_prevu: string | null;
  duree_estimee_min: number | null;
  status: string;
  external_source: string | null;
  currency: string;
  prix_prevu: string | null;
  client_price_ht: string | null;
  client_vat_rate: string | null;
  validated_price: string | null;
  provider_price: string | null;
  laundry_included: boolean;
  laundry_client_price_ht: string | null;
  laundry_provider_price: string | null;
  logement_id: string;
  logement_name: string | null;
  logement_address: string | null;
  logement_city: string | null;
  logement_color: string | null;
  referent_first_name: string | null;
  referent_last_name: string | null;
}

export interface ReportMenage extends ReportMenageRaw {
  prestataires: { id: string; first_name: string; last_name: string }[];
}

class ClientService extends BaseService<ClientRow> {
  constructor(db: Knex) {
    super(db, 'client');
  }

  async findActiveByOrg(
    organizationId: string,
    options: PaginationOptions & { search?: string } = {},
  ): Promise<PaginatedResult<ClientRow>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', search } = options;

    const baseQuery = this.db('client')
      .where({ organization_id: organizationId })
      .whereNull('archived_at');

    if (search) {
      const needle = `%${search}%`;
      baseQuery.where((qb) => {
        qb.whereILike('first_name', needle)
          .orWhereILike('last_name', needle)
          .orWhereILike('company_name', needle)
          .orWhereILike('email', needle)
          .orWhereILike('city', needle);
      });
    }

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = (await baseQuery
      .clone()
      .select('*')
      .orderBy(orderBy, order)
      .limit(limit)
      .offset((page - 1) * limit)) as ClientRow[];

    return {
      data,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  async findLogements(clientId: string): Promise<unknown[]> {
    return this.db('logement')
      .where({ client_id: clientId })
      .whereNull('archived_at')
      .orderBy('name', 'asc');
  }

  /**
   * Rapport compta : tous les ménages d'un client (via logement.client_id) sur
   * une période [from, to], avec leurs prix, options linge et prestataires.
   * Exclut les ménages annulés (pas de facturation).
   */
  async getReport(clientId: string, from: string, to: string): Promise<ReportMenage[]> {
    const rows = (await this.db('menage')
      .innerJoin('logement', 'menage.logement_id', 'logement.id')
      .leftJoin('user as referent', 'menage.prestataire_user_id', 'referent.id')
      .where('logement.client_id', clientId)
      .whereNot('menage.status', 'annule')
      .whereNull('menage.archived_at')
      .whereBetween('menage.date_prevue', [from, to])
      .orderBy('menage.date_prevue', 'asc')
      .select(
        'menage.id',
        'menage.date_prevue',
        'menage.date_realisation',
        'menage.horaire_prevu',
        'menage.duree_estimee_min',
        'menage.status',
        'menage.external_source',
        'menage.currency',
        'menage.prix_prevu',
        'menage.client_price_ht',
        'menage.client_vat_rate',
        'menage.validated_price',
        'menage.provider_price',
        'menage.laundry_included',
        'menage.laundry_client_price_ht',
        'menage.laundry_provider_price',
        'logement.id as logement_id',
        'logement.name as logement_name',
        'logement.address as logement_address',
        'logement.city as logement_city',
        'logement.color as logement_color',
        'referent.first_name as referent_first_name',
        'referent.last_name as referent_last_name',
      )) as ReportMenageRaw[];

    const menageIds = rows.map((r) => r.id);
    const presta =
      menageIds.length === 0
        ? []
        : ((await this.db('menage_prestataire')
            .innerJoin('user', 'menage_prestataire.user_id', 'user.id')
            .whereIn('menage_prestataire.menage_id', menageIds)
            .select(
              'menage_prestataire.menage_id',
              'user.id',
              'user.first_name',
              'user.last_name',
            )) as { menage_id: string; id: string; first_name: string; last_name: string }[]);

    const byMenage = new Map<string, { id: string; first_name: string; last_name: string }[]>();
    for (const p of presta) {
      const list = byMenage.get(p.menage_id) ?? [];
      list.push({ id: p.id, first_name: p.first_name, last_name: p.last_name });
      byMenage.set(p.menage_id, list);
    }

    return rows.map((r) => ({ ...r, prestataires: byMenage.get(r.id) ?? [] }));
  }

  async archive(id: string): Promise<ClientRow | undefined> {
    const [row] = (await this.db('client')
      .where({ id })
      .whereNull('archived_at')
      .update({ archived_at: new Date(), updated_at: new Date() })
      .returning('*')) as ClientRow[];
    return row;
  }
}

export default ClientService;
