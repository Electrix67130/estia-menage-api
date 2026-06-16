import { Knex } from 'knex';
import { GenerateInvoice, InvoiceRow, InvoiceLineRow, UpdateInvoice } from './invoice.schema';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface BillableMenage {
  id: string;
  date_prevue: string | Date;
  client_price_ht: string | null;
  client_vat_rate: string | null;
  laundry_included: boolean;
  laundry_client_price_ht: string | null;
  logement_name: string | null;
}

class InvoiceService {
  constructor(private db: Knex) {}

  private fmtDate(d: string | Date): string {
    const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    const [y, m, day] = s.split('-');
    return `${day}/${m}/${y}`;
  }

  /** Ménages déjà rattachés à une facture non annulée (anti double-facturation). */
  private async alreadyInvoicedIds(orgId: string): Promise<Set<string>> {
    const rows = (await this.db('invoice_line')
      .join('invoice', 'invoice_line.invoice_id', 'invoice.id')
      .where('invoice.organization_id', orgId)
      .whereNot('invoice.status', 'cancelled')
      .whereNotNull('invoice_line.menage_id')
      .pluck('invoice_line.menage_id')) as string[];
    return new Set(rows);
  }

  /** Génère une facture/devis brouillon (sans numéro) à partir des ménages du client. */
  async generate(orgId: string, userId: string, data: GenerateInvoice): Promise<InvoiceRow> {
    const base = this.db('menage')
      .leftJoin('logement', 'menage.logement_id', 'logement.id')
      .where('menage.organization_id', orgId)
      .whereNot('menage.status', 'annule')
      .select(
        'menage.id',
        'menage.date_prevue',
        'menage.client_price_ht',
        'menage.client_vat_rate',
        'menage.laundry_included',
        'menage.laundry_client_price_ht',
        'logement.name as logement_name',
      );

    if (data.menage_ids?.length) {
      base.whereIn('menage.id', data.menage_ids);
    } else {
      base
        .where('logement.client_id', data.client_id)
        .whereBetween('menage.date_prevue', [data.period_start!, data.period_end!]);
    }

    const menages = (await base.orderBy('menage.date_prevue', 'asc')) as BillableMenage[];
    const invoiced = await this.alreadyInvoicedIds(orgId);
    const billable = menages.filter((m) => !invoiced.has(m.id));
    if (billable.length === 0) {
      throw Object.assign(new Error('Aucun ménage facturable (déjà facturés ou hors période)'), {
        statusCode: 400,
      });
    }

    type LineDraft = Omit<InvoiceLineRow, 'id' | 'invoice_id'>;
    const lines: LineDraft[] = [];
    let pos = 0;
    for (const m of billable) {
      const ht = Number(m.client_price_ht ?? 0);
      const vat = Number(m.client_vat_rate ?? 0);
      const lineHt = round2(ht);
      const lineTva = round2((lineHt * vat) / 100);
      lines.push({
        menage_id: m.id,
        label: `Ménage du ${this.fmtDate(m.date_prevue)}${m.logement_name ? ` — ${m.logement_name}` : ''}`,
        quantity: '1',
        unit_price_ht: ht.toFixed(2),
        vat_rate: vat.toFixed(2),
        line_ht: lineHt.toFixed(2),
        line_tva: lineTva.toFixed(2),
        line_ttc: round2(lineHt + lineTva).toFixed(2),
        position: pos++,
      });
      if (m.laundry_included && m.laundry_client_price_ht) {
        const lht = round2(Number(m.laundry_client_price_ht));
        const ltva = round2((lht * vat) / 100);
        lines.push({
          menage_id: m.id,
          label: `Linge — ménage du ${this.fmtDate(m.date_prevue)}`,
          quantity: '1',
          unit_price_ht: lht.toFixed(2),
          vat_rate: vat.toFixed(2),
          line_ht: lht.toFixed(2),
          line_tva: ltva.toFixed(2),
          line_ttc: round2(lht + ltva).toFixed(2),
          position: pos++,
        });
      }
    }

    const totalHt = round2(lines.reduce((s, l) => s + Number(l.line_ht), 0));
    const totalTva = round2(lines.reduce((s, l) => s + Number(l.line_tva), 0));
    const totalTtc = round2(totalHt + totalTva);

    return this.db.transaction(async (trx) => {
      const [invoice] = (await trx('invoice')
        .insert({
          organization_id: orgId,
          client_id: data.client_id,
          type: data.type,
          status: 'draft',
          issue_date: new Date().toISOString().slice(0, 10),
          due_date: data.due_date ?? null,
          period_start: data.period_start ?? null,
          period_end: data.period_end ?? null,
          total_ht: totalHt.toFixed(2),
          total_tva: totalTva.toFixed(2),
          total_ttc: totalTtc.toFixed(2),
          notes: data.notes ?? null,
          created_by: userId,
        })
        .returning('*')) as InvoiceRow[];

      await trx('invoice_line').insert(lines.map((l) => ({ ...l, invoice_id: invoice.id })));
      return invoice;
    });
  }

  async getWithLines(
    orgId: string,
    id: string,
  ): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] } | null> {
    const invoice = (await this.db('invoice')
      .where({ id, organization_id: orgId })
      .first()) as InvoiceRow | undefined;
    if (!invoice) return null;
    const lines = (await this.db('invoice_line')
      .where({ invoice_id: id })
      .orderBy('position', 'asc')) as InvoiceLineRow[];
    return { invoice, lines };
  }

  async list(
    orgId: string,
    filters: { type?: string; status?: string; client_id?: string },
  ): Promise<InvoiceRow[]> {
    const q = this.db('invoice').where('organization_id', orgId);
    if (filters.type) q.where('type', filters.type);
    if (filters.status) q.where('status', filters.status);
    if (filters.client_id) q.where('client_id', filters.client_id);
    return (await q.orderBy('created_at', 'desc')) as InvoiceRow[];
  }

  /** Attribue le prochain numéro séquentiel (sans trou) pour (org, type, année). */
  private async assignNumber(trx: Knex.Transaction, invoice: InvoiceRow): Promise<string> {
    const year = (invoice.issue_date ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
    const prefix = invoice.type === 'quote' ? `D${year}-` : `${year}-`;
    // Verrou : on lit les numéros existants de l'année pour ce type, en FOR UPDATE.
    const rows = (await trx('invoice')
      .where({ organization_id: invoice.organization_id, type: invoice.type })
      .whereNotNull('number')
      .andWhere('number', 'like', `${prefix}%`)
      .forUpdate()
      .select('number')) as { number: string }[];
    const max = rows.reduce((mx, r) => {
      const n = parseInt(r.number.slice(prefix.length), 10);
      return Number.isFinite(n) && n > mx ? n : mx;
    }, 0);
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  async update(orgId: string, id: string, data: UpdateInvoice): Promise<InvoiceRow | null> {
    return this.db.transaction(async (trx) => {
      const invoice = (await trx('invoice')
        .where({ id, organization_id: orgId })
        .forUpdate()
        .first()) as InvoiceRow | undefined;
      if (!invoice) return null;

      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (data.due_date !== undefined) patch.due_date = data.due_date;
      if (data.notes !== undefined) patch.notes = data.notes;
      if (data.status) {
        patch.status = data.status;
        // Numéro attribué dès qu'on quitte le brouillon (finalisation).
        if (data.status !== 'draft' && data.status !== 'cancelled' && !invoice.number) {
          patch.number = await this.assignNumber(trx, invoice);
        }
      }
      const [updated] = (await trx('invoice')
        .where({ id })
        .update(patch)
        .returning('*')) as InvoiceRow[];
      return updated;
    });
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    // Seuls les brouillons sont supprimables (les finalisées restent pour l'audit).
    const n = await this.db('invoice')
      .where({ id, organization_id: orgId, status: 'draft' })
      .del();
    return n > 0;
  }

  // --- Paie prestataire ---------------------------------------------------

  async markProviderPaid(
    orgId: string,
    menageIds: string[],
    paid: boolean,
    userId: string,
  ): Promise<number> {
    return this.db('menage')
      .where('organization_id', orgId)
      .whereIn('id', menageIds)
      .update({
        provider_paid_at: paid ? new Date() : null,
        provider_paid_by: paid ? userId : null,
        updated_at: new Date(),
      });
  }

  /** Récap des montants à payer aux prestataires (ménages réalisés non payés). */
  async providerRecap(
    orgId: string,
  ): Promise<{ user_id: string; first_name: string; last_name: string; n_menages: number; total: number }[]> {
    const rows = (await this.db('menage')
      .join('menage_prestataire', 'menage.id', 'menage_prestataire.menage_id')
      .join('user', 'menage_prestataire.user_id', 'user.id')
      .where('menage.organization_id', orgId)
      .whereIn('menage.status', ['termine', 'valide'])
      .whereNull('menage.provider_paid_at')
      .groupBy('user.id', 'user.first_name', 'user.last_name')
      .select(
        'user.id as user_id',
        'user.first_name',
        'user.last_name',
        this.db.raw('count(*)::int as n_menages'),
        this.db.raw('coalesce(sum(menage.provider_price), 0)::float as total'),
      )) as {
      user_id: string;
      first_name: string;
      last_name: string;
      n_menages: number;
      total: number;
    }[];
    return rows;
  }
}

export default InvoiceService;
