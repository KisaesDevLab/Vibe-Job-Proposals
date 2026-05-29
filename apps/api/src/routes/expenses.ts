import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync, unlinkSync, createReadStream, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ok, fail, expenseSchema } from '@darrow/shared';
import { db, expenses, expenseAttachments } from '@darrow/db';
import { eq, and, gte, lte, desc, sql, isNull, isNotNull } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { paths } from '../storage.js';
import { writeAudit } from '../audit.js';
import { enqueueImageToPdf } from '../queue.js';
import { hasHeicSupport } from '../media.js';

export const expensesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const HEIC_MIMES = ['image/heic', 'image/heif'];

expensesRouter.get(
  '/',
  ah(async (req, res) => {
    const { job_id, from, to, invoice_status } = req.query as Record<string, string>;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const pageSize = Math.min(200, parseInt((req.query.pageSize as string) ?? '50', 10));
    const conds = [];
    if (job_id) conds.push(eq(expenses.jobId, job_id));
    if (from) conds.push(gte(expenses.workDate, from));
    if (to) conds.push(lte(expenses.workDate, to));
    if (invoice_status === 'billed') conds.push(isNotNull(expenses.invoiceId));
    if (invoice_status === 'unbilled') conds.push(isNull(expenses.invoiceId));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(expenses).where(where).orderBy(desc(expenses.workDate)).limit(pageSize).offset((page - 1) * pageSize);
    const data = [];
    for (const r of rows) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(expenseAttachments).where(eq(expenseAttachments.expenseId, r.id));
      data.push({ ...r, attachment_count: n });
    }
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(expenses).where(where);
    res.json(ok({ expenses: data, page, pageSize, total: count }));
  }),
);

expensesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [row] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
    if (!row) throw new HttpError(404, 'not_found', 'Expense not found');
    const atts = await db.select().from(expenseAttachments).where(eq(expenseAttachments.expenseId, row.id));
    res.json(ok({ ...row, attachments: atts }));
  }),
);

expensesRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = expenseSchema.parse(req.body);
    const [row] = await db
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
    await writeAudit({ userId: req.user?.id, entityType: 'expense', entityId: row.id, action: 'create', summary: `Created expense ${row.vendor} $${row.amount}` });
    res.status(201).json(ok(row));
  }),
);

expensesRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const [cur] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
    if (!cur) throw new HttpError(404, 'not_found', 'Expense not found');
    if (cur.invoiceId) return res.status(409).json(fail('locked', 'Expense is billed and locked'));
    const body = expenseSchema.partial().parse(req.body);
    const [row] = await db
      .update(expenses)
      .set({
        workDate: body.work_date,
        vendor: body.vendor,
        reference: body.reference,
        amount: body.amount != null ? String(body.amount) : undefined,
        category: body.category,
        description: body.description,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, req.params.id))
      .returning();
    res.json(ok(row));
  }),
);

expensesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const [cur] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
    if (!cur) throw new HttpError(404, 'not_found', 'Expense not found');
    if (cur.invoiceId) return res.status(409).json(fail('locked', 'Expense is billed and locked'));
    const dir = join(paths.invoicesDir(), '..', 'expenses', cur.id);
    await db.delete(expenses).where(eq(expenses.id, cur.id));
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    res.json(ok({ deleted: true }));
  }),
);

expensesRouter.post(
  '/:id/attachments',
  upload.single('file'),
  ah(async (req, res) => {
    const [exp] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
    if (!exp) throw new HttpError(404, 'not_found', 'Expense not found');
    if (exp.invoiceId) return res.status(409).json(fail('locked', 'Expense is billed and locked'));
    if (!req.file) throw new HttpError(400, 'no_file', 'No file uploaded');
    const ft = await fileTypeFromBuffer(req.file.buffer);
    const mime = ft?.mime ?? req.file.mimetype;
    const isPdf = mime === 'application/pdf';
    const isImage = IMAGE_MIMES.includes(mime);
    const isHeic = HEIC_MIMES.includes(mime);
    if (isHeic && !hasHeicSupport()) {
      return res.status(400).json(fail('heic_unsupported', 'HEIC not supported on this server — please share as JPG or PDF'));
    }
    if (!isPdf && !isImage && !isHeic) {
      return res.status(400).json(fail('bad_type', `Unsupported file type ${mime}`));
    }
    const attId = randomUUID();
    if (isPdf) {
      const dest = join(paths.expenseDir(exp.id), `${attId}.pdf`);
      writeFileSync(dest, req.file.buffer, { mode: 0o600 });
      const [row] = await db
        .insert(expenseAttachments)
        .values({ id: attId, expenseId: exp.id, originalFilename: req.file.originalname, storedPath: dest, contentType: mime, fileSizeBytes: req.file.size, status: 'ready' })
        .returning();
      return res.status(201).json(ok(row));
    }
    // image -> pending, enqueue conversion
    const ext = (extname(req.file.originalname) || `.${ft?.ext ?? 'img'}`).toLowerCase();
    const pendingPath = join(paths.expensePending(exp.id), `${attId}${ext}`);
    writeFileSync(pendingPath, req.file.buffer, { mode: 0o600 });
    const [row] = await db
      .insert(expenseAttachments)
      .values({ id: attId, expenseId: exp.id, originalFilename: req.file.originalname, storedPath: pendingPath, contentType: mime, fileSizeBytes: req.file.size, status: 'pending' })
      .returning();
    await enqueueImageToPdf(attId);
    res.status(201).json(ok(row));
  }),
);

expensesRouter.delete(
  '/attachments/:id',
  ah(async (req, res) => {
    const [att] = await db.select().from(expenseAttachments).where(eq(expenseAttachments.id, req.params.id));
    if (!att) throw new HttpError(404, 'not_found', 'Attachment not found');
    const [exp] = await db.select().from(expenses).where(eq(expenses.id, att.expenseId));
    if (exp?.invoiceId) return res.status(409).json(fail('locked', 'Parent expense is billed'));
    if (existsSync(att.storedPath)) unlinkSync(att.storedPath);
    await db.delete(expenseAttachments).where(eq(expenseAttachments.id, att.id));
    res.json(ok({ deleted: true }));
  }),
);

expensesRouter.get(
  '/attachments/:id/download',
  ah(async (req, res) => {
    const [att] = await db.select().from(expenseAttachments).where(eq(expenseAttachments.id, req.params.id));
    if (!att || !existsSync(att.storedPath)) return res.status(404).end();
    res.type('application/pdf');
    createReadStream(att.storedPath).pipe(res);
  }),
);

expensesRouter.post(
  '/attachments/:id/retry',
  ah(async (req, res) => {
    const [att] = await db.select().from(expenseAttachments).where(eq(expenseAttachments.id, req.params.id));
    if (!att) throw new HttpError(404, 'not_found', 'Attachment not found');
    await db.update(expenseAttachments).set({ status: 'pending', retryCount: 0 }).where(eq(expenseAttachments.id, att.id));
    await enqueueImageToPdf(att.id);
    res.json(ok({ requeued: true }));
  }),
);
