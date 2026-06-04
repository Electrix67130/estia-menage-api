import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import { MenageRow, ListMenagesQuery } from './menage.schema';
import { generateChecklistForMenage } from '@/modules/menage-check/menage-check.service';
import { LogementRow } from '@/modules/logement/logement.schema';

interface FindOptions extends Omit<ListMenagesQuery, 'manager'> {
  managerUserId?: string;
  restrictToMember?: boolean;
}

class MenageService extends BaseService<MenageRow> {
  constructor(db: Knex) {
    super(db, 'menage');
  }

  /**
   * Détail d'un ménage avec les infos prestataire jointes (nom/prénom/avatar).
   * Préférer à `findById` quand on a besoin du nom du prestataire dans l'UI.
   */
  async findByIdWithPrestataire(id: string): Promise<MenageRow | undefined> {
    return this.db('menage')
      .leftJoin('user as prestataire', 'menage.prestataire_user_id', 'prestataire.id')
      .leftJoin('logement', 'menage.logement_id', 'logement.id')
      .where('menage.id', id)
      .first(
        'menage.*',
        'prestataire.first_name as prestataire_first_name',
        'prestataire.last_name as prestataire_last_name',
        'prestataire.avatar_url as prestataire_avatar_url',
        'logement.name as logement_name',
        'logement.address as logement_address',
        'logement.city as logement_city',
        'logement.color as logement_color',
        'logement.latitude as logement_latitude',
        'logement.longitude as logement_longitude',
        this.db.raw(
          "EXISTS (SELECT 1 FROM menage_reschedule_request mrr WHERE mrr.menage_id = menage.id AND mrr.status = 'pending') as has_pending_reschedule",
        ),
      ) as Promise<MenageRow | undefined>;
  }

  async findActive(
    organizationId: string,
    options: FindOptions,
  ): Promise<PaginatedResult<MenageRow>> {
    const {
      page = 1,
      limit = 20,
      orderBy = 'date_prevue',
      order = 'desc',
      status,
      prestataire_user_id,
      logement_id,
      validated,
      unassigned,
      managerUserId,
      restrictToMember,
      from,
      to,
    } = options;

    // Filters communs aux deux requêtes (count + data) — pas de joins ici pour que
    // le count reste rapide (les joins étaient gaspillées dans la version précédente).
    const applyFilters = (qb: Knex.QueryBuilder) => {
      qb.where({ 'menage.organization_id': organizationId }).whereNull('menage.archived_at');
      if (status) qb.where('menage.status', status);
      if (prestataire_user_id) qb.where('menage.prestataire_user_id', prestataire_user_id);
      if (logement_id) qb.where('menage.logement_id', logement_id);
      if (validated === true) qb.whereNotNull('menage.validated_at');
      if (validated === false) qb.whereNull('menage.validated_at');
      if (unassigned === true) qb.whereNull('menage.prestataire_user_id');
      if (unassigned === false) qb.whereNotNull('menage.prestataire_user_id');
      if (from) qb.where('menage.date_prevue', '>=', from);
      if (to) qb.where('menage.date_prevue', '<=', to);
      if (restrictToMember && managerUserId) {
        qb.where((sub) => {
          sub.where('menage.prestataire_user_id', managerUserId).orWhereExists(function () {
            this.select('*')
              .from('logement_member')
              .whereRaw('logement_member.logement_id = menage.logement_id')
              .where('logement_member.user_id', managerUserId);
          });
        });
      }
    };

    const countQuery = this.db('menage');
    applyFilters(countQuery);

    const dataQuery = this.db('menage')
      .leftJoin('user as prestataire', 'menage.prestataire_user_id', 'prestataire.id')
      .leftJoin('logement', 'menage.logement_id', 'logement.id');
    applyFilters(dataQuery);

    // Lancer count + data en parallèle au lieu de séquentiel.
    const [countResult, data] = (await Promise.all([
      countQuery.count('* as count') as Promise<{ count: string }[]>,
      dataQuery
        .select(
          'menage.*',
          'prestataire.first_name as prestataire_first_name',
          'prestataire.last_name as prestataire_last_name',
          'prestataire.avatar_url as prestataire_avatar_url',
          'logement.name as logement_name',
          'logement.address as logement_address',
          'logement.city as logement_city',
          'logement.color as logement_color',
          this.db.raw(
            "EXISTS (SELECT 1 FROM menage_reschedule_request mrr WHERE mrr.menage_id = menage.id AND mrr.status = 'pending') as has_pending_reschedule",
          ),
        )
        .orderBy(`menage.${orderBy}`, order)
        .limit(limit)
        .offset((page - 1) * limit) as Promise<MenageRow[]>,
    ])) as [{ count: string }[], MenageRow[]];
    const count = countResult[0].count;

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

  /**
   * Crée un ménage et génère automatiquement sa checklist (sections + items)
   * à partir des paramètres du logement parent. Tout en une seule transaction.
   *
   * Les compteurs de couchage (lit simple/double/canapé/appoint) sont copiés
   * depuis le logement si non fournis dans le payload (override par ménage
   * possible côté admin pour saisonnalité / demande spéciale).
   */
  async createWithChecklist(
    data: Partial<MenageRow>,
    logement: LogementRow,
  ): Promise<MenageRow> {
    const withDefaults: Partial<MenageRow> = {
      ...data,
      n_lit_simple: data.n_lit_simple ?? logement.n_lit_simple,
      n_lit_double: data.n_lit_double ?? logement.n_lit_double,
      n_canape_lit: data.n_canape_lit ?? logement.n_canape_lit,
      n_lit_appoint: data.n_lit_appoint ?? logement.n_lit_appoint,
    };
    return this.db.transaction(async (trx) => {
      const [menage] = (await trx('menage').insert(withDefaults).returning('*')) as MenageRow[];
      await generateChecklistForMenage(trx, menage.id, logement);
      return menage;
    });
  }

  async recordArrival(
    id: string,
    proof: { photoUrl: string; lat: number; lng: number },
  ): Promise<MenageRow | undefined> {
    const now = new Date();
    const [row] = (await this.db('menage')
      .where({ id })
      .update({
        arrived_at: now,
        status: 'en_cours',
        arrival_photo_url: proof.photoUrl,
        arrival_lat: proof.lat,
        arrival_lng: proof.lng,
        updated_at: now,
      })
      .returning('*')) as MenageRow[];
    return row;
  }

  async recordDeparture(
    id: string,
    proof: { photoUrl: string; lat: number; lng: number },
  ): Promise<MenageRow | undefined> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const [row] = (await this.db('menage')
      .where({ id })
      .update({
        departed_at: now,
        date_realisation: today,
        status: 'termine',
        departure_photo_url: proof.photoUrl,
        departure_lat: proof.lat,
        departure_lng: proof.lng,
        updated_at: now,
      })
      .returning('*')) as MenageRow[];
    return row;
  }

  async validateReport(
    id: string,
    validatorUserId: string,
    overridePrice?: number,
  ): Promise<MenageRow | undefined> {
    const existing = (await this.db('menage').where({ id }).first()) as MenageRow | undefined;
    if (!existing) return undefined;
    const priceToUse =
      overridePrice !== undefined
        ? overridePrice
        : existing.prix_prevu
          ? Number(existing.prix_prevu)
          : null;
    const now = new Date();
    const [row] = (await this.db('menage')
      .where({ id })
      .update({
        validated_at: now,
        validated_by: validatorUserId,
        validated_price: priceToUse,
        status: 'valide',
        updated_at: now,
      })
      .returning('*')) as MenageRow[];
    return row;
  }
}

export default MenageService;
