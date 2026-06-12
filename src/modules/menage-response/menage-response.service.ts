import { Knex } from 'knex';
import {
  MenageResponseRow,
  MenageResponseWithUser,
  MenageResponseStatus,
  MyUpcomingMenage,
} from './menage-response.schema';
import { computeNeedsAttention, MenageStatus } from '@/modules/menage/menage.schema';
import { signUrlsInList } from '@/lib/sign-url';

class MenageResponseService {
  constructor(private db: Knex) {}

  async findByMenage(menageId: string): Promise<MenageResponseWithUser[]> {
    const rows = (await this.db('menage_response')
      .leftJoin('user', 'menage_response.user_id', 'user.id')
      .where('menage_response.menage_id', menageId)
      .select(
        'menage_response.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.avatar_url',
      )
      .orderBy('menage_response.responded_at', 'desc')) as MenageResponseWithUser[];
    return signUrlsInList(rows, ['avatar_url']);
  }

  /**
   * Upsert : si une réponse existe déjà pour (menage_id, user_id), on met à jour
   * le status + responded_at. Sinon on crée. La contrainte UNIQUE garantit
   * qu'on n'a jamais 2 réponses pour le même couple.
   */
  async upsert(
    menageId: string,
    userId: string,
    status: MenageResponseStatus,
  ): Promise<MenageResponseRow> {
    const now = new Date();
    await this.db('menage_response')
      .insert({
        menage_id: menageId,
        user_id: userId,
        status,
        responded_at: now,
        updated_at: now,
      })
      .onConflict(['menage_id', 'user_id'])
      .merge({ status, responded_at: now, updated_at: now });

    const row = (await this.db('menage_response')
      .where({ menage_id: menageId, user_id: userId })
      .first()) as MenageResponseRow;
    return row;
  }

  /**
   * Liste des prochains ménages pour un prestataire :
   * - sur des logements où il est member role='prestataire'
   * - statut != annulé et != validé (workflow en cours)
   * - filtré par plage de dates (defaults : today → today+90 jours)
   * - inclut sa réponse perso si elle existe
   */
  async findMyUpcomingMenages(
    userId: string,
    organizationId: string,
    options: { from?: string; to?: string; mode?: 'upcoming' | 'history' } = {},
  ): Promise<MyUpcomingMenage[]> {
    const today = new Date().toISOString().slice(0, 10);
    const mode = options.mode ?? 'upcoming';
    const defaultTo =
      mode === 'history'
        ? today
        : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const defaultFrom =
      mode === 'history'
        ? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : today;
    const from = options.from ?? defaultFrom;
    const to = options.to ?? defaultTo;

    const baseQuery = this.db('menage')
      .leftJoin('logement', 'menage.logement_id', 'logement.id')
      .leftJoin('user as referent', 'menage.prestataire_user_id', 'referent.id')
      .leftJoin('menage_response', function () {
        this.on('menage_response.menage_id', '=', 'menage.id').andOnVal(
          'menage_response.user_id',
          '=',
          userId,
        );
      })
      .where('menage.organization_id', organizationId)
      .whereNull('menage.archived_at');

    if (mode === 'history') {
      baseQuery
        .whereBetween('menage.date_prevue', [from, to])
        .whereIn('menage.status', ['termine', 'valide']);
    } else {
      // Upcoming : ménages dans la fenêtre [from, to] À VENIR, PLUS les
      // ménages « en retard non pointés » (jour passé, toujours a_venir, aucun
      // pointage) — sinon le presta ne verrait jamais un ménage qu'il a oublié
      // de faire (et qu'on veut justement mettre en évidence).
      baseQuery.whereNotIn('menage.status', ['annule', 'valide']).where(function () {
        this.whereBetween('menage.date_prevue', [from, to]).orWhere(function () {
          this.where('menage.status', 'a_venir')
            .whereNull('menage.arrived_at')
            .where('menage.date_prevue', '<', today);
        });
      });
    }

    const rows = (await baseQuery
      // Visibilité du ménage pour ce presta : soit il est membre prestataire du
      // logement (et voit donc tous ses ménages), soit il a été affecté
      // ponctuellement à CE ménage (remplacement) — dans ce 2e cas il ne voit
      // que ce ménage précis, pas les autres du logement.
      .whereRaw(
        `(
          EXISTS (SELECT 1 FROM logement_member lm WHERE lm.logement_id = menage.logement_id AND lm.user_id = ? AND lm.role = 'prestataire')
          OR EXISTS (SELECT 1 FROM menage_prestataire mp WHERE mp.menage_id = menage.id AND mp.user_id = ?)
        )`,
        [userId, userId],
      )
      // Un membre du logement ne voit que les ménages ouverts (personne
      // d'affecté) ou ceux où il est affecté. Dès qu'un ménage est affecté à
      // quelqu'un d'autre, il disparaît de sa liste.
      .whereRaw(
        `(
          NOT EXISTS (SELECT 1 FROM menage_prestataire mp WHERE mp.menage_id = menage.id)
          OR EXISTS (SELECT 1 FROM menage_prestataire mp WHERE mp.menage_id = menage.id AND mp.user_id = ?)
        )`,
        [userId],
      )
      .select(
        'menage.id',
        'menage.logement_id',
        'menage.date_prevue',
        'menage.horaire_prevu',
        'menage.duree_estimee_min',
        'menage.status',
        'menage.arrived_at',
        'logement.name as logement_name',
        'logement.address as logement_address',
        'logement.city as logement_city',
        'logement.color as logement_color',
        'menage_response.status as my_response',
        'referent.first_name as referent_first_name',
        'referent.last_name as referent_last_name',
        this.db.raw(
          'EXISTS (SELECT 1 FROM menage_prestataire mp WHERE mp.menage_id = menage.id AND mp.user_id = ?) as is_assigned',
          [userId],
        ),
        this.db.raw(
          'EXISTS (SELECT 1 FROM menage_prestataire mp WHERE mp.menage_id = menage.id) as assigned_to_someone',
        ),
        this.db.raw('(menage.prestataire_user_id = ?) as done_by_me', [userId]),
      )
      .orderBy('menage.date_prevue', 'asc')) as (Omit<MyUpcomingMenage, 'needs_attention'> & {
      arrived_at: string | null;
    })[];

    return rows.map(({ arrived_at, ...rest }) => ({
      ...rest,
      needs_attention: computeNeedsAttention({
        status: rest.status as MenageStatus,
        date_prevue: rest.date_prevue,
        arrived_at,
      }),
    }));
  }

  /**
   * Vérifie qu'un user est bien prestataire sur le logement parent d'un ménage.
   * Renvoie le logement_id si OK, sinon null.
   */
  async getLogementForMember(
    menageId: string,
    userId: string,
  ): Promise<{ logement_id: string; menage_status: string } | null> {
    const row = (await this.db('menage')
      .innerJoin('logement_member', function () {
        this.on('logement_member.logement_id', '=', 'menage.logement_id')
          .andOnVal('logement_member.user_id', '=', userId)
          .andOnVal('logement_member.role', '=', 'prestataire');
      })
      .where('menage.id', menageId)
      .select('menage.logement_id', 'menage.status as menage_status')
      .first()) as { logement_id: string; menage_status: string } | undefined;
    return row ?? null;
  }
}

export default MenageResponseService;
