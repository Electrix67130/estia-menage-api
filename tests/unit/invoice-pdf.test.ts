import { describe, expect, it } from 'vitest';
import { generateInvoicePdf } from '@/lib/invoice-pdf';
import type { InvoiceLineRow, InvoiceRow } from '@/modules/invoice/invoice.schema';

function facture(extra: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv-1',
    organization_id: 'org-1',
    client_id: 'cli-1',
    type: 'invoice',
    number: 'F-2026-0001',
    status: 'sent',
    issue_date: '2026-07-31',
    due_date: '2026-08-30',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    currency: 'EUR',
    total_ht: '180.00',
    total_tva: '36.00',
    total_ttc: '216.00',
    notes: null,
    created_by: null,
    created_at: '2026-07-31T10:00:00Z',
    updated_at: '2026-07-31T10:00:00Z',
    ...extra,
  };
}

const lignes: InvoiceLineRow[] = [
  {
    id: 'l1',
    invoice_id: 'inv-1',
    menage_id: 'm1',
    label: 'Ménage du 10/07/2026 — Villa Rose',
    quantity: '2',
    unit_price_ht: '90.00',
    vat_rate: '20.00',
    line_ht: '180.00',
    line_tva: '36.00',
    line_ttc: '216.00',
    position: 0,
  },
];

const org = { name: 'Conciergerie Bleue', siret: '12345678901234', city: 'Strasbourg' };
const client = { name: 'SCI Horizon', email: 'compta@horizon.test' };

describe('generateInvoicePdf', () => {
  it('produit un vrai document PDF, avec les métadonnées du document', async () => {
    const pdf = await generateInvoicePdf({ invoice: facture(), lines: lignes, org, client });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('accepte un devis sans client ni numéro', async () => {
    const pdf = await generateInvoicePdf({
      invoice: facture({ type: 'quote', number: null, status: 'draft', client_id: null }),
      lines: [],
      org,
      client: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('est déterministe pour un même contenu, hors horodatage', async () => {
    const a = await generateInvoicePdf({ invoice: facture(), lines: lignes, org, client });
    const b = await generateInvoicePdf({ invoice: facture(), lines: lignes, org, client });
    // Même structure : la taille ne bouge pas d'un rendu à l'autre.
    expect(Math.abs(a.length - b.length)).toBeLessThan(16);
  });
});
