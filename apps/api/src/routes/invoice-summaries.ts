import { Router } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import {
  ok, fail, summaryDraftSchema, summaryUpdateSchema, summaryMembersSchema, voidSchema,
} from '@darrow/shared';
import { sql as rawsql } from '@darrow/db';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  createDraft, loadSummary, updateDraft, addMembers, removeMembers,
  finalizeSummary, voidSummary, getEligibleInvoices, suggestBilledReference, memberDateRange,
} from '../services/summary.js';
import { enqueueRenderSummaryPdf } from '../queue.js';

export const invoiceSummariesRouter = Router();

invoiceSummariesRouter.get(
  '/',
  ah(async (req, res) => {
    const { customer_id, status } = req.query as Record<string, string>;
    const rows = await rawsql<any[]>`
      SELECT s.id, s.billed_reference, s.status, s.grand_total, s.created_at,
             s.finalized_at, s.pdf_status, s.work_start_date::text AS work_start_date,
             s.work_end_date::text AS work_end_date, c.name AS customer_name,
             (SELECT count(*)::int FROM invoice_summary_members m WHERE m.summary_id = s.id) AS member_count
      FROM invoice_summaries s JOIN customers c ON c.id = s.customer_id
      WHERE (${customer_id ?? null}::uuid IS NULL OR s.customer_id = ${customer_id ?? null}::uuid)
        AND (${status ?? null}::text IS NULL OR s.status = ${status ?? null}::invoice_status)
      ORDER BY s.created_at DESC`;
    res.json(ok(rows));
  }),
);

invoiceSummariesRouter.get(
  '/eligible-invoices',
  ah(async (req, res) => {
    const { customer_id } = req.query as Record<string, string>;
    if (!customer_id) throw new HttpError(400, 'bad_request', 'customer_id required');
    const rows = await getEligibleInvoices(customer_id);
    res.json(ok(rows));
  }),
);

invoiceSummariesRouter.get(
  '/suggest-number',
  ah(async (req, res) => {
    const { customer_id, member_ids } = req.query as Record<string, string>;
    if (!customer_id) throw new HttpError(400, 'bad_request', 'customer_id required');
    const ids = (member_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const billed = await suggestBilledReference(customer_id, ids);
    const range = await memberDateRange(ids);
    res.json(ok({ billed_reference: billed, work_start_date: range.start, work_end_date: range.end }));
  }),
);

invoiceSummariesRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = summaryDraftSchema.parse(req.body);
    try {
      const result = await createDraft({ ...body, userId: req.user?.id });
      res.status(201).json(ok(result));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json(fail(err.code ?? 'error', err.message));
      throw err;
    }
  }),
);

invoiceSummariesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const row = await loadSummary(req.params.id);
    if (!row) throw new HttpError(404, 'not_found', 'Summary not found');
    res.json(ok(row));
  }),
);

invoiceSummariesRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = summaryUpdateSchema.parse(req.body);
    await updateDraft(req.params.id, body);
    res.json(ok({ updated: true }));
  }),
);

invoiceSummariesRouter.post(
  '/:id/members/include',
  ah(async (req: AuthedRequest, res) => {
    const body = summaryMembersSchema.parse(req.body);
    try {
      await addMembers(req.params.id, body.invoice_ids, req.user?.id);
      res.json(ok({ added: body.invoice_ids.length }));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json(fail(err.code ?? 'error', err.message));
      throw err;
    }
  }),
);

invoiceSummariesRouter.post(
  '/:id/members/exclude',
  ah(async (req: AuthedRequest, res) => {
    const body = summaryMembersSchema.parse(req.body);
    try {
      await removeMembers(req.params.id, body.invoice_ids, req.user?.id);
      res.json(ok({ removed: body.invoice_ids.length }));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json(fail(err.code ?? 'error', err.message));
      throw err;
    }
  }),
);

invoiceSummariesRouter.post(
  '/:id/finalize',
  ah(async (req: AuthedRequest, res) => {
    try {
      const result = await finalizeSummary(req.params.id, req.user?.id);
      await enqueueRenderSummaryPdf(req.params.id);
      res.json(ok(result));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json(fail(err.code ?? 'error', err.message));
      throw err;
    }
  }),
);

invoiceSummariesRouter.post(
  '/:id/void',
  ah(async (req: AuthedRequest, res) => {
    const { reason } = voidSchema.parse(req.body);
    try {
      await voidSummary(req.params.id, reason, req.user?.id);
      res.json(ok({ voided: true }));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json(fail(err.code ?? 'error', err.message));
      throw err;
    }
  }),
);

invoiceSummariesRouter.post(
  '/:id/regenerate',
  ah(async (req, res) => {
    await rawsql`UPDATE invoice_summaries SET pdf_status = 'pending', pdf_error = NULL WHERE id = ${req.params.id}`;
    await enqueueRenderSummaryPdf(req.params.id);
    res.json(ok({ regenerating: true }));
  }),
);

invoiceSummariesRouter.get(
  '/:id/pdf',
  ah(async (req, res) => {
    const [row] = await rawsql<any[]>`SELECT generated_pdf_path, billed_reference FROM invoice_summaries WHERE id = ${req.params.id}`;
    if (!row) throw new HttpError(404, 'not_found', 'Summary not found');
    if (!row.generated_pdf_path || !existsSync(row.generated_pdf_path)) {
      return res.status(404).json(fail('not_ready', 'Summary PDF not generated yet'));
    }
    res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${row.billed_reference}.pdf"`);
    createReadStream(row.generated_pdf_path).pipe(res);
  }),
);
