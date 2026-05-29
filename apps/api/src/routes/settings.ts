import { Router } from 'express';
import multer from 'multer';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ok, fail, settingsSchema, markupMapSchema, EXPENSE_CATEGORIES } from '@darrow/shared';
import { db, settings, settingsMarkupDefaults } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { paths } from '../storage.js';
import { writeAudit } from '../audit.js';

export const settingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function getSettings() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const markups = await db.select().from(settingsMarkupDefaults);
  return { ...row, markups };
}

function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

settingsRouter.get('/', ah(async (_req, res) => res.json(ok(await getSettings()))));

settingsRouter.put(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = settingsSchema.parse(req.body);
    await db
      .update(settings)
      .set({
        ...body,
        phone: normalizePhone(body.phone),
        email: body.email.toLowerCase(),
        updatedAt: new Date(),
      })
      .where(eq(settings.id, 1));
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: 'Updated company settings' });
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.put(
  '/markups',
  ah(async (req: AuthedRequest, res) => {
    const body = markupMapSchema.parse(req.body);
    await db.transaction(async (tx) => {
      for (const m of body) {
        await tx
          .insert(settingsMarkupDefaults)
          .values({ category: m.category, percent: String(m.percent) })
          .onConflictDoUpdate({ target: settingsMarkupDefaults.category, set: { percent: String(m.percent) } });
      }
    });
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: 'Updated markup defaults' });
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.post(
  '/logo',
  upload.single('file'),
  ah(async (req: AuthedRequest, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'No file uploaded');
    if (req.file.size > 2 * 1024 * 1024) return res.status(400).json(fail('too_large', 'Logo max 2MB'));
    const ft = await fileTypeFromBuffer(req.file.buffer);
    if (!ft || !['image/png', 'image/jpeg'].includes(ft.mime)) {
      return res.status(400).json(fail('bad_type', 'Logo must be PNG or JPEG'));
    }
    const ext = ft.mime === 'image/png' ? 'png' : 'jpg';
    const dest = join(paths.branding(), `logo.${ext}`);
    // remove other-ext logo if present
    for (const e of ['png', 'jpg']) {
      const p = join(paths.branding(), `logo.${e}`);
      if (e !== ext && existsSync(p)) unlinkSync(p);
    }
    writeFileSync(dest, req.file.buffer, { mode: 0o600 });
    await db.update(settings).set({ logoPath: dest, updatedAt: new Date() }).where(eq(settings.id, 1));
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.delete(
  '/logo',
  ah(async (_req, res) => {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    if (row?.logoPath && existsSync(row.logoPath)) unlinkSync(row.logoPath);
    await db.update(settings).set({ logoPath: null }).where(eq(settings.id, 1));
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.get(
  '/logo',
  ah(async (_req, res) => {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!row?.logoPath || !existsSync(row.logoPath)) return res.status(404).end();
    res.sendFile(row.logoPath);
  }),
);

settingsRouter.post(
  '/template',
  upload.single('file'),
  ah(async (req: AuthedRequest, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'No file uploaded');
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    // docx is a zip; file-type reports application/zip or the office mime
    const ft = await fileTypeFromBuffer(req.file.buffer);
    if (!ft || !['application/zip', docxMime, 'application/x-cfb'].includes(ft.mime)) {
      return res.status(400).json(fail('bad_type', 'Template must be a .docx file'));
    }
    const dest = join(paths.branding(), 'template.docx');
    writeFileSync(dest, req.file.buffer, { mode: 0o600 });
    await db.update(settings).set({ templateDocxPath: dest, updatedAt: new Date() }).where(eq(settings.id, 1));
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: 'Uploaded invoice template' });
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.delete(
  '/template',
  ah(async (_req, res) => {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    if (row?.templateDocxPath && existsSync(row.templateDocxPath)) unlinkSync(row.templateDocxPath);
    await db.update(settings).set({ templateDocxPath: null }).where(eq(settings.id, 1));
    res.json(ok(await getSettings()));
  }),
);

settingsRouter.get(
  '/template/download',
  ah(async (_req, res) => {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!row?.templateDocxPath || !existsSync(row.templateDocxPath)) return res.status(404).end();
    res.download(row.templateDocxPath, 'template.docx');
  }),
);

settingsRouter.get(
  '/placeholders',
  ah(async (_req, res) => {
    // Read the static reference doc.
    const docPath = join(process.cwd(), 'docs', 'PLACEHOLDERS.md');
    const text = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '# Placeholders\nSee docs/PLACEHOLDERS.md';
    res.json(ok({ markdown: text, categories: EXPENSE_CATEGORIES }));
  }),
);
