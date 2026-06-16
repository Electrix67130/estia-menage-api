import fp from 'fastify-plugin';
import { z } from 'zod';
import InvoiceService from './invoice.service';
import {
  generateInvoiceSchema,
  updateInvoiceSchema,
  markProviderPaidSchema,
} from './invoice.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { generateInvoicePdf, InvoicePdfParty } from '@/lib/invoice-pdf';

const uuidParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  type: z.enum(['invoice', 'quote']).optional(),
  status: z.string().optional(),
  client_id: z.string().uuid().optional(),
});

function clientName(c: { first_name?: string; last_name?: string; company_name?: string } | undefined): string {
  if (!c) return 'Client';
  return c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Client';
}

export default fp(
  (fastify, _opts, done) => {
    const service = new InvoiceService(fastify.db);

    // Toutes les routes facturation = admin only.
    const requireAdmin = async (userId: string) => {
      const m = await getActiveMembership(fastify.db, userId);
      if (!m || m.role !== 'admin') return null;
      return m.organization_id as string;
    };

    fastify.get('/invoices', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const filters = listQuery.parse(request.query);
      return { data: await service.list(orgId, filters) };
    });

    fastify.post('/invoices', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const data = generateInvoiceSchema.parse(request.body);
      const invoice = await service.generate(orgId, request.user.sub, data);
      return reply.code(201).send(invoice);
    });

    fastify.get('/invoices/provider-recap', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      return { data: await service.providerRecap(orgId) };
    });

    fastify.post('/invoices/provider-payments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { menage_ids, paid } = markProviderPaidSchema.parse(request.body);
      const updated = await service.markProviderPaid(orgId, menage_ids, paid, request.user.sub);
      return { updated };
    });

    // Export CSV comptable (factures finalisées d'une période).
    fastify.get('/invoices/export.csv', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(request.query);
      let q = fastify.db('invoice')
        .leftJoin('client', 'invoice.client_id', 'client.id')
        .where('invoice.organization_id', orgId)
        .whereNotNull('invoice.number');
      if (from) q = q.where('invoice.issue_date', '>=', from);
      if (to) q = q.where('invoice.issue_date', '<=', to);
      const rows = (await q
        .orderBy('invoice.issue_date', 'asc')
        .select('invoice.*', 'client.first_name', 'client.last_name', 'client.company_name')) as Array<
        Record<string, unknown> & { first_name?: string; last_name?: string; company_name?: string }
      >;
      const header = 'numero;type;date;client;total_ht;total_tva;total_ttc;statut';
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [header]
        .concat(
          rows.map((r) =>
            [r.number, r.type, r.issue_date, clientName(r), r.total_ht, r.total_tva, r.total_ttc, r.status]
              .map(esc)
              .join(';'),
          ),
        )
        .join('\n');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="factures.csv"');
      return reply.send('﻿' + csv); // BOM pour Excel
    });

    fastify.get('/invoices/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { id } = uuidParam.parse(request.params);
      const result = await service.getWithLines(orgId, id);
      if (!result) return reply.notFound('Invoice not found');
      return result;
    });

    fastify.patch('/invoices/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { id } = uuidParam.parse(request.params);
      const data = updateInvoiceSchema.parse(request.body);
      const updated = await service.update(orgId, id, data);
      if (!updated) return reply.notFound('Invoice not found');
      return updated;
    });

    fastify.delete('/invoices/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { id } = uuidParam.parse(request.params);
      const ok = await service.remove(orgId, id);
      if (!ok) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Seuls les brouillons sont supprimables' });
      return reply.code(204).send();
    });

    fastify.get('/invoices/:id/pdf', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const orgId = await requireAdmin(request.user.sub);
      if (!orgId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      const { id } = uuidParam.parse(request.params);
      const result = await service.getWithLines(orgId, id);
      if (!result) return reply.notFound('Invoice not found');
      const orgRow = await fastify.db('organization').where({ id: orgId }).first();
      const clientRow = result.invoice.client_id
        ? await fastify.db('client').where({ id: result.invoice.client_id }).first()
        : null;
      const org: InvoicePdfParty = {
        name: orgRow?.name ?? 'Estia',
        address: orgRow?.address,
        postal_code: orgRow?.postal_code,
        city: orgRow?.city,
        siret: orgRow?.siret,
        vat_number: orgRow?.vat_number,
        email: orgRow?.billing_email,
        phone: orgRow?.phone,
      };
      const client: InvoicePdfParty | null = clientRow
        ? {
            name: clientName(clientRow),
            address: clientRow.billing_address,
            postal_code: clientRow.postal_code,
            city: clientRow.city,
            siret: clientRow.siret,
            vat_number: clientRow.vat_number,
            email: clientRow.email,
          }
        : null;
      const pdf = await generateInvoicePdf({ invoice: result.invoice, lines: result.lines, org, client });
      const label = (result.invoice.number ?? 'brouillon').replace(/[^\w-]/g, '_');
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${result.invoice.type === 'quote' ? 'devis' : 'facture'}-${label}.pdf"`);
      return reply.send(pdf);
    });

    done();
  },
  { name: 'invoice-module' },
);
