import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { CreateLogementCode, DEFAULT_CODE_LABEL, LogementCodeRow } from './logement-code.schema';

class LogementCodeService extends BaseService<LogementCodeRow> {
  constructor(db: Knex) {
    super(db, 'logement_code');
  }

  /** Codes d'un logement, dans l'ordre d'affichage. */
  async findByLogement(logementId: string): Promise<LogementCodeRow[]> {
    return this.db('logement_code')
      .where({ logement_id: logementId })
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc');
  }

  /** Prochaine position libre (ajout en fin de liste). */
  private async nextPosition(logementId: string): Promise<number> {
    const row = (await this.db('logement_code')
      .where({ logement_id: logementId })
      .max('position as max')
      .first()) as { max: number | null } | undefined;
    return (row?.max ?? -1) + 1;
  }

  /**
   * `logement.key_safe_code` est conservé comme MIROIR du premier code de la
   * liste : le détail ménage l'expose déjà par jointure
   * (`logement_key_safe_code`) et les anciens clients le lisent encore. À
   * appeler après toute écriture sur `logement_code`.
   */
  async syncLegacyKeySafeCode(logementId: string): Promise<void> {
    const first = (await this.db('logement_code')
      .where({ logement_id: logementId })
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .first()) as LogementCodeRow | undefined;
    await this.db('logement')
      .where({ id: logementId })
      .update({ key_safe_code: first?.code ?? null, updated_at: new Date() });
  }

  async createForLogement(data: CreateLogementCode): Promise<LogementCodeRow> {
    const [row] = (await this.db('logement_code')
      .insert({
        ...data,
        label: data.label.trim(),
        code: data.code.trim(),
        position: data.position ?? (await this.nextPosition(data.logement_id)),
      })
      .returning('*')) as LogementCodeRow[];
    await this.syncLegacyKeySafeCode(data.logement_id);
    return row;
  }

  /**
   * Reprise du champ legacy `key_safe_code` (formulaires de création, anciens
   * clients) : le code atterrit dans la liste sous le libellé par défaut, en
   * tête. Une valeur vide supprime cette ligne. Idempotent.
   */
  async upsertFromLegacyField(logementId: string, code: string | null | undefined): Promise<void> {
    const trimmed = (code ?? '').trim();
    const existing = (await this.db('logement_code')
      .where({ logement_id: logementId, label: DEFAULT_CODE_LABEL })
      .orderBy('position', 'asc')
      .first()) as LogementCodeRow | undefined;

    if (!trimmed) {
      if (existing) await this.db('logement_code').where({ id: existing.id }).del();
      return;
    }
    if (existing) {
      if (existing.code !== trimmed) {
        await this.db('logement_code')
          .where({ id: existing.id })
          .update({ code: trimmed, updated_at: new Date() });
      }
      return;
    }
    await this.db('logement_code').insert({
      logement_id: logementId,
      label: DEFAULT_CODE_LABEL,
      code: trimmed,
      position: 0,
    });
  }
}

export default LogementCodeService;
