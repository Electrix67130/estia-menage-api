import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import { MenageRow, ListMenagesQuery } from './menage.schema';
import { generateChecklistForMenage } from '@/modules/menage-check/menage-check.service';
import { LogementRow } from '@/modules/logement/logement.schema';
import { signFields, signUrlsInList } from '@/lib/sign-url';

interface FindOptions extends Omit<ListMenagesQuery, 'manager' | 'assigned'> {
  managerUserId?: string;
  restrictToMember?: boolean;
  /** Restreint aux prestations où `managerUserId` est affecté (référent OU
   *  co-presta via `menage_prestataire`). Utilisé par l'historique presta. */
  restrictToAssignee?: boolean;
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
    const row = (await this.db('menage')
      .leftJoin('user as prestataire', 'menage.prestataire_user_id', 'prestataire.id')
      .leftJoin('logement', 'menage.logement_id', 'logement.id')
      .where('menage.id', id)
      .first(
        'menage.*',
        'prestataire.first_name as prestataire_first_name',
        'prestataire.last_name as prestataire_last_name',
        'prestataire.avatar_url as prestataire_avatar_url',
        'prestataire.avatar_thumbnail_url as prestataire_avatar_thumbnail_url',
        'logement.name as logement_name',
        'logement.address as logement_address',
        'logement.city as logement_city',
        'logement.color as logement_color',
        'logement.latitude as logement_latitude',
        'logement.longitude as logement_longitude',
        'logement.key_safe_code as logement_key_safe_code',
        this.db.raw(
          "EXISTS (SELECT 1 FROM menage_reschedule_request mrr WHERE mrr.menage_id = menage.id AND mrr.status = 'pending') as has_pending_reschedule",
        ),
      )) as MenageRow | undefined;
    return row
      ? signFields(row, [
          'prestataire_avatar_url',
          'prestataire_avatar_thumbnail_url',
          'arrival_photo_url',
          'departure_photo_url',
        ])
      : row;
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
      type,
      prestataire_user_id,
      logement_id,
      validated,
      unassigned,
      closed,
      managerUserId,
      restrictToMember,
      restrictToAssignee,
      from,
      to,
    } = options;

    // Filters communs aux deux requêtes (count + data) — pas de joins ici pour que
    // le count reste rapide (les joins étaient gaspillées dans la version précédente).
    const applyFilters = (qb: Knex.QueryBuilder) => {
      qb.where({ 'menage.organization_id': organizationId }).whereNull('menage.archived_at');
      if (status) qb.where('menage.status', status);
      if (type) qb.where('menage.prestation_type', type);
      if (prestataire_user_id) qb.where('menage.prestataire_user_id', prestataire_user_id);
      if (logement_id) qb.where('menage.logement_id', logement_id);
      if (validated === true) qb.whereNotNull('menage.validated_at');
      if (validated === false) qb.whereNull('menage.validated_at');
      if (unassigned === true) qb.whereNull('menage.prestataire_user_id');
      if (unassigned === false) qb.whereNotNull('menage.prestataire_user_id');
      if (closed === true) qb.whereIn('menage.status', ['valide', 'annule']);
      if (closed === false) qb.whereNotIn('menage.status', ['valide', 'annule']);
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
      if (restrictToAssignee && managerUserId) {
        qb.where((sub) => {
          sub.where('menage.prestataire_user_id', managerUserId).orWhereExists(function () {
            this.select('*')
              .from('menage_prestataire')
              .whereRaw('menage_prestataire.menage_id = menage.id')
              .where('menage_prestataire.user_id', managerUserId);
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
          'prestataire.avatar_thumbnail_url as prestataire_avatar_thumbnail_url',
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
      data: signUrlsInList(data, [
        'prestataire_avatar_url',
        'prestataire_avatar_thumbnail_url',
        'arrival_photo_url',
        'departure_photo_url',
      ]),
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
    proof: { photoUrl?: string; lat?: number; lng?: number },
    arrival?: {
      userId: string;
      travelerRating?: number;
      hasDegradation?: boolean;
      degradationNote?: string;
      degradationPhotos?: {
        url: string;
        thumbnail_url?: string;
        file_size?: number;
        mime_type?: string;
      }[];
      /** Horodatage réel du pointage (file d'attente hors ligne). Absent → now. */
      arrivedAt?: string;
    },
  ): Promise<MenageRow | undefined> {
    const now = new Date();
    // L'heure d'arrivée est celle du pointage côté client si fournie (un pointage
    // fait hors ligne a pu attendre le retour du réseau avant d'être envoyé).
    const arrivedAt = arrival?.arrivedAt ? new Date(arrival.arrivedAt) : now;
    return this.db.transaction(async (trx) => {
      const update: Record<string, unknown> = {
        arrived_at: arrivedAt,
        status: 'en_cours',
        updated_at: now,
      };
      // Photo + GPS facultatifs (obligatoires pour un ménage — imposé côté route ;
      // absents pour un check-in/check-out).
      if (proof.photoUrl !== undefined) update.arrival_photo_url = proof.photoUrl;
      if (proof.lat !== undefined) update.arrival_lat = proof.lat;
      if (proof.lng !== undefined) update.arrival_lng = proof.lng;
      if (arrival?.travelerRating !== undefined) update.traveler_rating = arrival.travelerRating;
      if (arrival?.hasDegradation !== undefined) update.has_degradation = arrival.hasDegradation;
      if (arrival?.degradationNote !== undefined) update.degradation_note = arrival.degradationNote;
      const [row] = (await trx('menage').where({ id }).update(update).returning('*')) as MenageRow[];

      // Photos de dégradation → table photo, taguées is_degradation.
      if (arrival?.hasDegradation && arrival.degradationPhotos?.length && arrival.userId) {
        await trx('photo').insert(
          arrival.degradationPhotos.map((p) => ({
            menage_id: id,
            uploaded_by: arrival.userId,
            url: p.url,
            thumbnail_url: p.thumbnail_url ?? null,
            mime_type: p.mime_type ?? null,
            file_size: p.file_size ?? null,
            taken_at: now,
            is_degradation: true,
          })),
        );
      }
      return row;
    });
  }

  /**
   * Met à jour la déclaration voyageurs (note + dégradation) après coup, sans
   * re-pointer. Champs optionnels ; les photos de dégradation sont ajoutées à
   * la galerie (taguées `is_degradation`).
   */
  async updateDeclaration(
    id: string,
    fields: {
      travelerRating?: number;
      hasDegradation?: boolean;
      degradationNote?: string;
      degradationPhotos?: {
        url: string;
        thumbnail_url?: string;
        file_size?: number;
        mime_type?: string;
      }[];
    },
    userId: string,
  ): Promise<MenageRow | undefined> {
    const now = new Date();
    return this.db.transaction(async (trx) => {
      const update: Record<string, unknown> = { updated_at: now };
      if (fields.travelerRating !== undefined) update.traveler_rating = fields.travelerRating;
      if (fields.hasDegradation !== undefined) update.has_degradation = fields.hasDegradation;
      if (fields.degradationNote !== undefined) update.degradation_note = fields.degradationNote;
      const [row] = (await trx('menage').where({ id }).update(update).returning('*')) as MenageRow[];

      if (fields.degradationPhotos?.length) {
        await trx('photo').insert(
          fields.degradationPhotos.map((p) => ({
            menage_id: id,
            uploaded_by: userId,
            url: p.url,
            thumbnail_url: p.thumbnail_url ?? null,
            mime_type: p.mime_type ?? null,
            file_size: p.file_size ?? null,
            taken_at: now,
            is_degradation: true,
          })),
        );
      }
      return row;
    });
  }

  async recordDeparture(
    id: string,
    proof: { photoUrl?: string; lat?: number; lng?: number },
    /** Horodatage réel du départ (file d'attente hors ligne). Absent → now. */
    departedAt?: string,
  ): Promise<MenageRow | undefined> {
    const now = new Date();
    const departed = departedAt ? new Date(departedAt) : now;
    // Date de réalisation = jour réel du départ (pas le jour de la synchro).
    const today = departed.toISOString().slice(0, 10);
    const update: Record<string, unknown> = {
      departed_at: departed,
      date_realisation: today,
      status: 'termine',
      updated_at: now,
    };
    // Photo + GPS facultatifs (cf. recordArrival).
    if (proof.photoUrl !== undefined) update.departure_photo_url = proof.photoUrl;
    if (proof.lat !== undefined) update.departure_lat = proof.lat;
    if (proof.lng !== undefined) update.departure_lng = proof.lng;
    const [row] = (await this.db('menage')
      .where({ id })
      .update(update)
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
