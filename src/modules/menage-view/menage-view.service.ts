import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  MenageViewRow,
  MenageTab,
  UnreadCounts,
  UnreadSummary,
} from './menage-view.schema';

/**
 * Calcul des « non-lus » : pour un onglet donné d'un ménage, on compte les
 * items créés après la dernière consultation (`menage_view.last_viewed_at`),
 * en excluant ceux produits par l'utilisateur lui-même. Seuls les onglets
 * adossés à une entité réelle sont comptés (commentaires, commentaires
 * d'étapes = `comment` avec `section_id`, photos) ; le reste vaut 0.
 */
class MenageViewService extends BaseService<MenageViewRow> {
  constructor(db: Knex) {
    super(db, 'menage_view');
  }

  /** Upsert : enregistre/rafraîchit la dernière consultation d'un onglet. */
  async markTabViewed(userId: string, menageId: string, tab: MenageTab): Promise<void> {
    await this.db('menage_view')
      .insert({
        user_id: userId,
        menage_id: menageId,
        tab,
        last_viewed_at: this.db.fn.now(),
      })
      .onConflict(['user_id', 'menage_id', 'tab'])
      .merge({ last_viewed_at: this.db.fn.now(), updated_at: this.db.fn.now() });
  }

  /** Compteurs détaillés pour un ménage précis. */
  async getUnreadForMenage(userId: string, menageId: string): Promise<UnreadCounts> {
    const [comments, stepRows, photos, commentsView] = await Promise.all([
      this.countComments(userId, [menageId], 'general', 'comments'),
      this.unreadStepRows(userId, menageId),
      this.countPhotos(userId, [menageId]),
      this.db('menage_view')
        .where({ user_id: userId, menage_id: menageId, tab: 'comments' })
        .first('last_viewed_at') as Promise<{ last_viewed_at: string } | undefined>,
    ]);
    const unread_step_ids = [...new Set(stepRows.map((r) => r.section_id))];
    return {
      comments: comments.get(menageId) ?? 0,
      comments_steps: stepRows.length,
      photos: photos.get(menageId) ?? 0,
      documents: 0,
      emergencies: 0,
      emergencies_claim: 0,
      unread_step_ids,
      unread_emergency_ids: [],
      comments_last_viewed_at: commentsView?.last_viewed_at ?? null,
    };
  }

  /** Synthèse par ménage + par organisation, scopée aux ménages visibles. */
  async getUnreadSummary(
    userId: string,
    organizationId: string,
    isAdmin: boolean,
  ): Promise<UnreadSummary> {
    const menages = await this.getVisibleMenages(userId, organizationId, isAdmin);
    if (menages.length === 0) {
      return { by_menage: {}, by_organization: {}, by_type: {} };
    }
    const menageIds = menages.map((m) => m.id);
    const typeById = new Map(menages.map((m) => [m.id, m.prestation_type]));

    const [cGen, cStep, cPhoto] = await Promise.all([
      this.countComments(userId, menageIds, 'general', 'comments'),
      this.countComments(userId, menageIds, 'steps', 'comments_steps'),
      this.countPhotos(userId, menageIds),
    ]);

    const by_menage: Record<string, number> = {};
    // Ventilé par type de prestation → chaque item de nav a son propre badge
    // (le badge « Ménages » n'est plus pollué par les check-in/check-out).
    const by_type: Record<string, number> = {};
    for (const id of menageIds) {
      const total = (cGen.get(id) ?? 0) + (cStep.get(id) ?? 0) + (cPhoto.get(id) ?? 0);
      if (total > 0) {
        by_menage[id] = total;
        const type = typeById.get(id) ?? 'menage';
        by_type[type] = (by_type[type] ?? 0) + total;
      }
    }
    const orgTotal = Object.values(by_menage).reduce((a, b) => a + b, 0);
    const by_organization = orgTotal > 0 ? { [organizationId]: orgTotal } : {};
    return { by_menage, by_organization, by_type };
  }

  /** Ménages visibles : tous (admin) ou affectés/membre (prestataire). */
  private async getVisibleMenages(
    userId: string,
    organizationId: string,
    isAdmin: boolean,
  ): Promise<{ id: string; prestation_type: string }[]> {
    const db = this.db;
    const query = db('menage')
      .where('menage.organization_id', organizationId)
      .whereNull('menage.archived_at')
      // Exclut les prestations clôturées (validé/annulé) : elles vivent dans les
      // Archives, pas dans la worklist. Ainsi chaque badge correspond à une
      // ligne réellement visible dans la liste active (cohérence badge ↔ liste).
      .whereNotIn('menage.status', ['valide', 'annule'])
      .select('menage.id', 'menage.prestation_type');

    if (!isAdmin) {
      // Un prestataire n'est notifié que pour les prestations où il est AFFECTÉ
      // (référent OU co-presta). Le simple statut de membre `prestataire` d'un
      // logement ne suffit pas — sinon une photo/un commentaire posé par un autre
      // presta sur SA prestation générerait un badge parasite. Seuls les membres
      // de rôle `manager` (superviseurs) gardent la visibilité sur tout le logement.
      query.where(function () {
        this.where('menage.prestataire_user_id', userId)
          .orWhereExists(function () {
            this.select(db.raw('1'))
              .from('menage_prestataire as mp')
              .whereRaw('mp.menage_id = menage.id')
              .where('mp.user_id', userId);
          })
          .orWhereExists(function () {
            this.select(db.raw('1'))
              .from('logement_member as lm')
              .whereRaw('lm.logement_id = menage.logement_id')
              .where('lm.user_id', userId)
              .where('lm.role', 'manager');
          });
      });
    }

    return (await query) as { id: string; prestation_type: string }[];
  }

  /** Compte les commentaires non lus par ménage (généraux ou d'étapes). */
  private async countComments(
    userId: string,
    menageIds: string[],
    mode: 'general' | 'steps',
    tab: MenageTab,
  ): Promise<Map<string, number>> {
    if (menageIds.length === 0) return new Map();
    const query = this.db('comment as c')
      .leftJoin('menage_view as v', function () {
        this.on('v.menage_id', '=', 'c.menage_id')
          .andOnVal('v.user_id', '=', userId)
          .andOnVal('v.tab', '=', tab);
      })
      .whereIn('c.menage_id', menageIds)
      .whereNot('c.author_id', userId)
      .whereRaw('(v.last_viewed_at IS NULL OR c.created_at > v.last_viewed_at)')
      .groupBy('c.menage_id')
      .select('c.menage_id')
      .count('* as count');
    if (mode === 'general') query.whereNull('c.section_id');
    else query.whereNotNull('c.section_id');
    const rows = (await query) as { menage_id: string; count: string }[];
    return new Map(rows.map((r) => [r.menage_id, Number(r.count)]));
  }

  /** Lignes de commentaires d'étapes non lus pour un ménage (→ section_ids). */
  private async unreadStepRows(
    userId: string,
    menageId: string,
  ): Promise<{ section_id: string }[]> {
    return (await this.db('comment as c')
      .leftJoin('menage_view as v', function () {
        this.on('v.menage_id', '=', 'c.menage_id')
          .andOnVal('v.user_id', '=', userId)
          .andOnVal('v.tab', '=', 'comments_steps');
      })
      .where('c.menage_id', menageId)
      .whereNotNull('c.section_id')
      .whereNot('c.author_id', userId)
      .whereRaw('(v.last_viewed_at IS NULL OR c.created_at > v.last_viewed_at)')
      .select('c.section_id')) as { section_id: string }[];
  }

  /** Compte les photos non lues par ménage. */
  private async countPhotos(
    userId: string,
    menageIds: string[],
  ): Promise<Map<string, number>> {
    if (menageIds.length === 0) return new Map();
    const rows = (await this.db('photo as p')
      .leftJoin('menage_view as v', function () {
        this.on('v.menage_id', '=', 'p.menage_id')
          .andOnVal('v.user_id', '=', userId)
          .andOnVal('v.tab', '=', 'photos');
      })
      .whereIn('p.menage_id', menageIds)
      .whereNot('p.uploaded_by', userId)
      .whereRaw('(v.last_viewed_at IS NULL OR p.created_at > v.last_viewed_at)')
      .groupBy('p.menage_id')
      .select('p.menage_id')
      .count('* as count')) as { menage_id: string; count: string }[];
    return new Map(rows.map((r) => [r.menage_id, Number(r.count)]));
  }
}

export default MenageViewService;
