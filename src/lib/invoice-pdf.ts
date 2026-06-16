import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { InvoiceRow, InvoiceLineRow } from '@/modules/invoice/invoice.schema';

const BRAND = '#2563EB';
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-estia.png');

export interface InvoicePdfParty {
  name: string;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  siret?: string | null;
  vat_number?: string | null;
  email?: string | null;
  phone?: string | null;
}

function eur(n: string | number): string {
  return `${Number(n).toFixed(2).replace('.', ',')} €`;
}

function frDate(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** Génère le PDF d'une facture / devis et renvoie un Buffer. */
export function generateInvoicePdf(params: {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  org: InvoicePdfParty;
  client: InvoicePdfParty | null;
}): Promise<Buffer> {
  const { invoice, lines, org, client } = params;
  const isQuote = invoice.type === 'quote';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- En-tête : logo + émetteur ---
    try {
      if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 50, 45, { height: 60 });
    } catch {
      /* logo optionnel */
    }
    doc.fontSize(16).fillColor(BRAND).text(org.name, 130, 50);
    doc.fontSize(9).fillColor('#444');
    const orgLines = [
      [org.address, [org.postal_code, org.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      org.siret ? `SIRET ${org.siret}` : '',
      org.vat_number ? `TVA ${org.vat_number}` : '',
      [org.email, org.phone].filter(Boolean).join(' · '),
    ].filter(Boolean);
    doc.text(orgLines.join('\n'), 130, 72);

    // --- Titre + méta ---
    doc.moveDown(2);
    doc.fontSize(22).fillColor('#0F172A').text(isQuote ? 'DEVIS' : 'FACTURE', 50, 140);
    doc.fontSize(10).fillColor('#444');
    doc.text(`N° ${invoice.number ?? '(brouillon)'}`, 50, 172);
    doc.text(`Date : ${frDate(invoice.issue_date)}`, 50, 186);
    if (invoice.due_date) doc.text(`Échéance : ${frDate(invoice.due_date)}`, 50, 200);
    if (invoice.period_start && invoice.period_end) {
      doc.text(`Période : ${frDate(invoice.period_start)} → ${frDate(invoice.period_end)}`, 50, 214);
    }

    // --- Client (bloc à droite) ---
    if (client) {
      const cx = 330;
      doc.fontSize(10).fillColor('#0F172A').text('Facturé à', cx, 172);
      doc.fontSize(10).fillColor('#444');
      const cl = [
        client.name,
        [client.address].filter(Boolean).join(''),
        [client.postal_code, client.city].filter(Boolean).join(' '),
        client.siret ? `SIRET ${client.siret}` : '',
        client.vat_number ? `TVA ${client.vat_number}` : '',
      ].filter(Boolean);
      doc.text(cl.join('\n'), cx, 188, { width: 215 });
    }

    // --- Tableau des lignes ---
    let y = 270;
    const cols = { label: 50, qty: 320, pu: 360, tva: 430, total: 480 };
    doc.fontSize(9).fillColor('#fff');
    doc.rect(50, y - 4, 495, 20).fill(BRAND);
    doc.fillColor('#fff');
    doc.text('Désignation', cols.label + 4, y);
    doc.text('Qté', cols.qty, y);
    doc.text('PU HT', cols.pu, y);
    doc.text('TVA', cols.tva, y);
    doc.text('Total HT', cols.total, y);
    y += 22;

    doc.fillColor('#0F172A').fontSize(9);
    for (const l of lines) {
      const h = Math.max(16, Math.ceil(doc.heightOfString(l.label, { width: 260 })));
      if (y + h > 740) {
        doc.addPage();
        y = 60;
      }
      doc.fillColor('#0F172A').text(l.label, cols.label, y, { width: 260 });
      doc.text(Number(l.quantity).toString(), cols.qty, y);
      doc.text(eur(l.unit_price_ht), cols.pu, y);
      doc.text(`${Number(l.vat_rate).toFixed(0)}%`, cols.tva, y);
      doc.text(eur(l.line_ht), cols.total, y);
      y += h + 6;
      doc.moveTo(50, y - 3).lineTo(545, y - 3).strokeColor('#E2E8F0').stroke();
    }

    // --- Totaux ---
    y += 10;
    const tx = 400;
    doc.fontSize(10).fillColor('#444');
    doc.text('Total HT', tx, y).text(eur(invoice.total_ht), 480, y);
    y += 16;
    doc.text('TVA', tx, y).text(eur(invoice.total_tva), 480, y);
    y += 18;
    doc.fontSize(12).fillColor('#0F172A').text('Total TTC', tx, y).text(eur(invoice.total_ttc), 478, y);

    // --- Notes + mentions légales ---
    y += 40;
    if (invoice.notes) {
      doc.fontSize(9).fillColor('#444').text(invoice.notes, 50, y, { width: 495 });
      y += 30;
    }
    doc.fontSize(8).fillColor('#94A3B8');
    const mentions = isQuote
      ? 'Devis valable 30 jours. Bon pour accord à retourner daté et signé.'
      : "TVA non applicable, art. 293 B du CGI le cas échéant. En cas de retard de paiement, pénalités au taux légal + indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
    doc.text(mentions, 50, 770, { width: 495 });

    doc.end();
  });
}
