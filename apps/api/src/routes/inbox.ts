import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, copyFileSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { ok, fail, expenseSchema } from '@darrow/shared';
import { db, inboxDocuments, expenses, expenseAttachments } from '@darrow/db';
import { eq, desc } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { paths } from '../storage.js';
import { writeAudit } from '../audit.js';
import { enqueueInboxToPdf } from '../queue.js';
import { ingestInboxFile } from '../services/inbox-ingest.js';

export const inboxRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/inbox — multi-file upload of bills into the processing box.
inboxRouter.post(
  '/',
  upload.array('files', 20),
  ah(async (req: AuthedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new HttpError(400, 'no_file', 'No files uploaded');
    const created: any[] = [];
    const rejected: { filename: string; reason: string }[] = [];
    for (const file of files) {
      const r = await ingestInboxFile(file, { source: 'admin', uploadedByUserId: req.user?.id ?? null });
      if (r.row) created.push(r.row);
      if (r.rejected) rejected.push(r.rejected);
    }
    await writeAudit({ userId: req.user?.id, entityType: 'inbox', entityId: 'batch', action: 'create', summary: `Uploaded ${created.length} bill(s) to inbox` });
    res.status(201).json(ok({ created, rejected }));
  }),
);

// GET /api/inbox — the unprocessed queue (processed docs are deleted).
inboxRouter.get(
  '/',
  ah(async (_req, res) => {
    const rows = await db
      .select({
        id: inboxDocuments.id,
        original_filename: inboxDocuments.originalFilename,
        content_type: inboxDocuments.contentType,
        file_size_bytes: inboxDocuments.fileSizeBytes,
        status: inboxDocuments.status,
        submitted_job_code: inboxDocuments.submittedJobCode,
        notes: inboxDocuments.notes,
        source: inboxDocuments.source,
        created_at: inboxDocuments.createdAt,
      })
      .from(inboxDocuments)
      .orderBy(desc(inboxDocuments.createdAt));
    res.json(ok(rows));
  }),
);

inboxRouter.get(
  '/:id/download',
  ah(async (req, res) => {
    const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, req.params.id));
    if (!doc || !existsSync(doc.storedPath)) return res.status(404).end();
    res.type('application/pdf');
    createReadStream(doc.storedPath).pipe(res);
  }),
);

// First-page PNG thumbnail (same gs+graphicsmagick path as expense attachments).
inboxRouter.get(
  '/:id/preview',
  ah(async (req, res) => {
    const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, req.params.id));
    if (!doc || !existsSync(doc.storedPath)) return res.status(404).end();
    if (doc.status !== 'ready') return res.status(409).json(fail('not_ready', 'Document not converted yet'));
    const thumb = doc.storedPath.replace(/\.pdf$/i, '.thumb.png');
    if (!existsSync(thumb)) {
      const { fromPath } = await import('pdf2pic');
      const dir = dirname(doc.storedPath);
      const base = basename(thumb, '.png');
      await fromPath(doc.storedPath, { density: 100, savePath: dir, saveFilename: base, format: 'png', width: 600, preserveAspectRatio: true })(1);
      const produced = join(dir, `${base}.1.png`);
      if (existsSync(produced) && !existsSync(thumb)) renameSync(produced, thumb);
    }
    if (!existsSync(thumb)) return res.status(500).json(fail('thumb_failed', 'Could not render thumbnail'));
    res.type('image/png');
    createReadStream(thumb).pipe(res);
  }),
);

inboxRouter.post(
  '/:id/retry',
  ah(async (req, res) => {
    const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, req.params.id));
    if (!doc) throw new HttpError(404, 'not_found', 'Document not found');
    await db.update(inboxDocuments).set({ status: 'pending', retryCount: 0 }).where(eq(inboxDocuments.id, doc.id));
    await enqueueInboxToPdf(doc.id);
    res.json(ok({ requeued: true }));
  }),
);

// POST /api/inbox/:id/process — turn a ready bill into an expense + attachment,
// then remove the inbox record. Copy-then-delete so a failure leaves no dangling row.
inboxRouter.post(
  '/:id/process',
  ah(async (req: AuthedRequest, res) => {
    const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, req.params.id));
    if (!doc) throw new HttpError(404, 'not_found', 'Document not found');
    if (doc.status !== 'ready') return res.status(409).json(fail('not_ready', 'Document is still converting or failed; cannot process'));
    if (!existsSync(doc.storedPath)) return res.status(409).json(fail('missing_file', 'Underlying file is missing'));
    const body = expenseSchema.parse(req.body);
    const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (body.work_date > limit) return res.status(400).json(fail('future_date', 'work_date is more than 30 days in the future'));

    const result = await db.transaction(async (tx) => {
      const [exp] = await tx
        .insert(expenses)
        .values({
          workDate: body.work_date,
          jobId: body.job_id,
          vendor: body.vendor,
          reference: body.reference ?? null,
          amount: String(body.amount),
          category: body.category,
          description: body.description ?? null,
        })
        .returning();
      const attId = randomUUID();
      const dest = join(paths.expenseDir(exp.id), `${attId}.pdf`);
      copyFileSync(doc.storedPath, dest);
      const [att] = await tx
        .insert(expenseAttachments)
        .values({ id: attId, expenseId: exp.id, originalFilename: doc.originalFilename, storedPath: dest, contentType: 'application/pdf', fileSizeBytes: doc.fileSizeBytes, status: 'ready' })
        .returning();
      return { expense: exp, attachment: att };
    });

    // After commit: drop the inbox record + its storage dir.
    await db.delete(inboxDocuments).where(eq(inboxDocuments.id, doc.id));
    const inboxDir = paths.inboxDir(doc.id);
    if (existsSync(inboxDir)) rmSync(inboxDir, { recursive: true, force: true });

    await writeAudit({ userId: req.user?.id, entityType: 'expense', entityId: result.expense.id, action: 'create', summary: `Processed inbox bill into expense ${result.expense.vendor} $${result.expense.amount}` });
    res.status(201).json(ok(result));
  }),
);

inboxRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, req.params.id));
    if (!doc) throw new HttpError(404, 'not_found', 'Document not found');
    await db.delete(inboxDocuments).where(eq(inboxDocuments.id, doc.id));
    const dir = paths.inboxDir(doc.id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    res.json(ok({ deleted: true }));
  }),
);
