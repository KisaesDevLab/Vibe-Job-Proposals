import { Router } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import {
  ok,
  fail,
  invoiceDraftSchema,
  invoiceUpdateSchema,
  invoiceEntriesSchema,
  invoiceMarkupOverrideSchema,
  voidSchema,
  emailSchema,
} from '@darrow/shared';
import { db, sql as rawsql, invoices, invoiceLineItems, invoiceMarkupOverrides, timeEntries, expenses, invoiceEmails } from '@darrow/db';
import { eq, and, isNull, inArray, desc, asc } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';
import { buildPreview, finalizeInvoice } from '../services/invoice.js';
import { enqueueRenderDocx, enqueueSendEmail } from '../queue.js';

export const invoicesRouter = Router();

invoicesRouter.get(
  '/',
  ah(async (req, res) => {
    const { status, customer_id, job_id } = req.query as Record<string, string>;
    const includeVoid = req.query.includeVoid === 'true';
    const rows = await rawsql<any[]>`
      SELECT i.id, i.billed_reference, i.sequence_number, i.status, i.through_date::text AS through_date,
             i.grand_total, i.created_at, i.finalized_at, i.imported_from_xlsm,
             i.docx_status, i.pdf_status, j.code AS job_code, j.customer_id, c.name AS customer_name
      FROM invoices i JOIN jobs j ON j.id=i.job_id JOIN customers c ON c.id=j.customer_id
      WHERE (${status ?? null}::text IS NULL OR i.status = ${status ?? null}::invoice_status)
        AND (${status ? true : includeVoid} OR i.status != 'void')
        AND (${customer_id ?? null}::uuid IS NULL OR j.customer_id = ${customer_id ?? null}::uuid)
        AND (${job_id ?? null}::uuid IS NULL OR i.job_id = ${job_id ?? null}::uuid)
      ORDER BY i.created_at DESC`;
    res.json(ok(rows));
  }),
);

invoicesRouter.post(
  '/draft',
  ah(async (req: AuthedRequest, res) => {
    const body = invoiceDraftSchema.parse(req.body);
    if (body.through_date > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json(fail('future_date', 'through_date cannot be in the future'));
    }
    // one draft per job
    const existing = await db.select().from(invoices).where(and(eq(invoices.jobId, body.job_id), eq(invoices.status, 'draft')));
    if (existing.length) return res.status(409).json(fail('draft_exists', 'A draft already exists for this job', { invoice_id: existing[0].id }));
    const result = await rawsql.begin(async (tx: any) => {
      const [inv] = await tx`INSERT INTO invoices (job_id, through_date, created_by_user_id, status) VALUES (${body.job_id}, ${body.through_date}::date, ${req.user?.id ?? null}, 'draft') RETURNING *`;
      await tx`UPDATE time_entries SET invoice_id=${inv.id} WHERE job_id=${body.job_id} AND invoice_id IS NULL AND work_date <= ${body.through_date}::date`;
      await tx`UPDATE expenses SET invoice_id=${inv.id} WHERE job_id=${body.job_id} AND invoice_id IS NULL AND work_date <= ${body.through_date}::date`;
      return inv;
    });
    await writeAudit({ userId: req.user?.id, entityType: 'invoice', entityId: result.id, action: 'create', summary: `Created draft for job` });
    res.status(201).json(ok(result));
  }),
);

invoicesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [inv] = await rawsql<any[]>`
      SELECT i.*, j.code AS job_code, j.description AS job_description, j.billing_type, j.po_number,
             c.id AS customer_id, c.name AS customer_name, c.contact_email AS customer_contact_email
      FROM invoices i JOIN jobs j ON j.id=i.job_id JOIN customers c ON c.id=j.customer_id WHERE i.id=${req.params.id}`;
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    if (inv.status === 'draft') {
      const preview = await buildPreview(req.params.id);
      const boundTime = await rawsql`SELECT te.*, e.name AS employee_name FROM time_entries te JOIN employees e ON e.id=te.employee_id WHERE te.invoice_id=${inv.id} ORDER BY te.work_date`;
      const boundExp = await rawsql`SELECT * FROM expenses WHERE invoice_id=${inv.id} ORDER BY category, work_date`;
      const overrides = await db.select().from(invoiceMarkupOverrides).where(eq(invoiceMarkupOverrides.invoiceId, inv.id));
      return res.json(ok({ invoice: inv, preview, bound_time: boundTime, bound_expenses: boundExp, markup_overrides: overrides }));
    }
    // finalized/void: read snapshot
    const lines = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, inv.id)).orderBy(asc(invoiceLineItems.lineOrder));
    res.json(ok({ invoice: inv, line_items: lines }));
  }),
);

invoicesRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    const body = invoiceUpdateSchema.parse(req.body);
    if (inv.status !== 'draft') {
      // only notes editable after finalize
      if (body.through_date !== undefined) return res.status(409).json(fail('locked', 'Only notes editable after finalize'));
      await db.update(invoices).set({ notes: body.notes ?? '' }).where(eq(invoices.id, inv.id));
      return res.json(ok({ updated: true }));
    }
    if (body.through_date && body.through_date > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json(fail('future_date', 'through_date cannot be in the future'));
    }
    await db.update(invoices).set({ throughDate: body.through_date, notes: body.notes ?? undefined }).where(eq(invoices.id, inv.id));
    res.json(ok({ updated: true }));
  }),
);

async function assertDraft(id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
  if (inv.status !== 'draft') throw new HttpError(409, 'locked', 'Invoice is not a draft');
  return inv;
}

invoicesRouter.post(
  '/:id/entries/include',
  ah(async (req, res) => {
    await assertDraft(req.params.id);
    const body = invoiceEntriesSchema.parse(req.body);
    if (body.time_entry_ids.length)
      await db.update(timeEntries).set({ invoiceId: req.params.id }).where(and(inArray(timeEntries.id, body.time_entry_ids), isNull(timeEntries.invoiceId)));
    if (body.expense_ids.length)
      await db.update(expenses).set({ invoiceId: req.params.id }).where(and(inArray(expenses.id, body.expense_ids), isNull(expenses.invoiceId)));
    res.json(ok({ included: body.time_entry_ids.length + body.expense_ids.length }));
  }),
);

invoicesRouter.post(
  '/:id/entries/exclude',
  ah(async (req, res) => {
    await assertDraft(req.params.id);
    const body = invoiceEntriesSchema.parse(req.body);
    if (body.time_entry_ids.length)
      await db.update(timeEntries).set({ invoiceId: null }).where(and(inArray(timeEntries.id, body.time_entry_ids), eq(timeEntries.invoiceId, req.params.id)));
    if (body.expense_ids.length)
      await db.update(expenses).set({ invoiceId: null }).where(and(inArray(expenses.id, body.expense_ids), eq(expenses.invoiceId, req.params.id)));
    res.json(ok({ excluded: body.time_entry_ids.length + body.expense_ids.length }));
  }),
);

invoicesRouter.put(
  '/:id/markup-overrides',
  ah(async (req, res) => {
    await assertDraft(req.params.id);
    const body = invoiceMarkupOverrideSchema.parse(req.body);
    await db.transaction(async (tx) => {
      await tx.delete(invoiceMarkupOverrides).where(eq(invoiceMarkupOverrides.invoiceId, req.params.id));
      for (const m of body) await tx.insert(invoiceMarkupOverrides).values({ invoiceId: req.params.id, category: m.category, percent: String(m.percent) });
    });
    res.json(ok({ updated: body.length }));
  }),
);

invoicesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const inv = await assertDraft(req.params.id);
    await rawsql.begin(async (tx: any) => {
      await tx`UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=${inv.id}`;
      await tx`UPDATE expenses SET invoice_id=NULL WHERE invoice_id=${inv.id}`;
      await tx`DELETE FROM invoices WHERE id=${inv.id}`;
    });
    res.json(ok({ deleted: true }));
  }),
);

invoicesRouter.post(
  '/:id/finalize',
  ah(async (req: AuthedRequest, res) => {
    const result = await finalizeInvoice(req.params.id, req.user?.id ?? null);
    await writeAudit({ userId: req.user?.id, entityType: 'invoice', entityId: req.params.id, action: 'finalize', summary: `Finalized invoice ${result.billed_reference}` });
    await enqueueRenderDocx(req.params.id);
    res.json(ok(result));
  }),
);

invoicesRouter.post(
  '/:id/void',
  ah(async (req: AuthedRequest, res) => {
    const { reason } = voidSchema.parse(req.body);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    if (inv.status !== 'finalized') return res.status(409).json(fail('not_finalized', 'Only finalized invoices can be voided'));
    await rawsql.begin(async (tx: any) => {
      await tx`UPDATE invoices SET status='void', voided_at=now(), void_reason=${reason}, voided_by_user_id=${req.user?.id ?? null} WHERE id=${inv.id}`;
      await tx`UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=${inv.id}`;
      await tx`UPDATE expenses SET invoice_id=NULL WHERE invoice_id=${inv.id}`;
    });
    await writeAudit({ userId: req.user?.id, entityType: 'invoice', entityId: inv.id, action: 'void', summary: `Voided ${inv.billedReference}: ${reason}` });
    res.json(ok({ voided: true }));
  }),
);

// regenerate docx/pdf (also used by historical invoices)
invoicesRouter.post(
  '/:id/regenerate',
  ah(async (req, res) => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    await db.update(invoices).set({ docxStatus: 'pending', pdfStatus: 'pending', generationError: null }).where(eq(invoices.id, inv.id));
    await enqueueRenderDocx(inv.id);
    res.json(ok({ regenerating: true }));
  }),
);

function streamFile(res: any, path: string | null, type: string, filename: string) {
  if (!path || !existsSync(path)) return res.status(404).json(fail('not_ready', 'File not generated yet'));
  res.type(type).setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  createReadStream(path).pipe(res);
}

invoicesRouter.get(
  '/:id/docx',
  ah(async (req, res) => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    streamFile(res, inv.generatedDocxPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${inv.billedReference ?? inv.id}.docx`);
  }),
);

invoicesRouter.get(
  '/:id/pdf',
  ah(async (req, res) => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    streamFile(res, inv.generatedPdfPath, 'application/pdf', `${inv.billedReference ?? inv.id}.pdf`);
  }),
);

// Phase 17 email
invoicesRouter.post(
  '/:id/email',
  ah(async (req: AuthedRequest, res) => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!inv) throw new HttpError(404, 'not_found', 'Invoice not found');
    const body = emailSchema.parse(req.body);
    if (!body.include_docx && !body.include_pdf) return res.status(400).json(fail('no_attachment', 'Select at least one attachment'));
    const [row] = await db
      .insert(invoiceEmails)
      .values({ invoiceId: inv.id, toAddress: body.to, ccAddresses: body.cc, subject: body.subject, body: body.body, includedDocx: body.include_docx, includedPdf: body.include_pdf, sentByUserId: req.user?.id ?? null })
      .returning();
    await enqueueSendEmail(row.id);
    await writeAudit({ userId: req.user?.id, entityType: 'invoice', entityId: inv.id, action: 'email', summary: `Queued email to ${body.to}` });
    res.json(ok(row));
  }),
);

invoicesRouter.get(
  '/:id/emails',
  ah(async (req, res) => {
    const rows = await db.select().from(invoiceEmails).where(eq(invoiceEmails.invoiceId, req.params.id)).orderBy(desc(invoiceEmails.createdAt));
    res.json(ok(rows));
  }),
);

