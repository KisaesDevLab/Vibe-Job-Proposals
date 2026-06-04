import { z } from 'zod';
import { Router } from 'express';
import multer from 'multer';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ok, fail, settingsSchema, markupMapSchema, EXPENSE_CATEGORIES } from '@darrow/shared';
import { db, settings, settingsMarkupDefaults } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import { attachStreamErrorHandler } from '../http-stream.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { paths } from '../storage.js';
import { writeAudit } from '../audit.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

export const settingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function getSettings() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const markups = await db.select().from(settingsMarkupDefaults);
  // Strip every *_enc blob from the response; surface presence as a boolean.
  const { smtpPasswordEnc, cfApiTokenEnc, tunnelTokenEnc, ...safe } = row as any;
  return {
    ...safe,
    smtp_password_set: !!smtpPasswordEnc,
    cf_api_token_set: !!cfApiTokenEnc,
    tunnel_token_set: !!tunnelTokenEnc,
    markups,
  };
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

// Save SMTP config (Phase 17). Password encrypted at rest with AES-256-GCM.
settingsRouter.put(
  '/smtp',
  ah(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        smtp_host: z.string().nullable().optional(),
        smtp_port: z.coerce.number().int().nullable().optional(),
        smtp_user: z.string().nullable().optional(),
        smtp_password: z.string().nullable().optional(),
        smtp_from_address: z.string().nullable().optional(),
        smtp_from_name: z.string().nullable().optional(),
        smtp_enabled: z.boolean().optional(),
      })
      .parse(req.body);
    if ((body.smtp_enabled || body.smtp_password) && !process.env.SMTP_ENC_KEY) {
      return res.status(400).json(fail('no_enc_key', 'SMTP_ENC_KEY must be set to store SMTP credentials'));
    }
    const enc = body.smtp_password ? encryptSecret(body.smtp_password) : undefined;
    await db
      .update(settings)
      .set({
        smtpHost: body.smtp_host ?? undefined,
        smtpPort: body.smtp_port ?? undefined,
        smtpUser: body.smtp_user ?? undefined,
        smtpPasswordEnc: enc,
        smtpFromAddress: body.smtp_from_address ?? undefined,
        smtpFromName: body.smtp_from_name ?? undefined,
        smtpEnabled: body.smtp_enabled,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, 1));
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: 'Updated SMTP settings' });
    res.json(ok({ updated: true }));
  }),
);

// Download the committed starter template (Phase 14 task: example template endpoint).
settingsRouter.get(
  '/example-template',
  ah(async (_req, res) => {
    const p = join(process.cwd(), 'docs', 'example-template.docx');
    if (!existsSync(p)) return res.status(404).json(fail('not_found', 'Example template not found'));
    res.download(p, 'example-template.docx');
  }),
);

// SMTP test-connect (Phase 17): verify the transport, optionally send a test email.
settingsRouter.post(
  '/smtp/test',
  ah(async (_req, res) => {
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    if (!row?.smtpHost) return res.status(400).json(fail('not_configured', 'SMTP host not configured'));
    const nodemailer = (await import('nodemailer')).default;
    let password: string | undefined;
    if (row.smtpPasswordEnc) {
      try {
        password = decryptSecret(row.smtpPasswordEnc);
      } catch {
        return res.status(400).json(fail('decrypt_failed', 'Could not decrypt stored SMTP password'));
      }
    }
    const transport = nodemailer.createTransport({
      host: row.smtpHost,
      port: row.smtpPort ?? 587,
      secure: (row.smtpPort ?? 587) === 465,
      auth: row.smtpUser ? { user: row.smtpUser, pass: password } : undefined,
    });
    try {
      await transport.verify();
      // Test mail goes only to the configured From address — never an arbitrary recipient.
      const to = row.smtpFromAddress;
      if (to) {
        await transport.sendMail({ from: row.smtpFromName ? `"${row.smtpFromName}" <${row.smtpFromAddress}>` : row.smtpFromAddress ?? to, to, subject: 'Darrow SMTP test', text: 'SMTP configuration test from Darrow Time & Invoicing.' });
      }
      res.json(ok({ verified: true, sentTo: to ?? null }));
    } catch (e: any) {
      res.status(400).json(fail('smtp_failed', e?.message ?? 'SMTP test failed'));
    }
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

// ─── Cloudflare Tunnel + Caddy ─────────────────────────────────────────────
import { verifyToken as cfVerify, listAccounts as cfListAccounts, listZones as cfListZones, CfError } from '../services/cloudflare.js';
import { provisionTunnel, disableTunnel, tunnelStatus } from '../services/tunnel.js';

const tunnelVerifySchema = z.object({ api_token: z.string().min(8) });
const tunnelProvisionSchema = z.object({
  api_token: z.string().min(8),
  account_id: z.string().min(1),
  zone_id: z.string().min(1),
  zone_name: z.string().min(1),
  tunnel_name: z.string().min(1).max(60).regex(/^[a-zA-Z0-9._-]+$/, 'tunnel_name letters/digits/._- only'),
  subdomain: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'subdomain must be lowercase letters/digits/hyphens'),
});

settingsRouter.get(
  '/tunnel',
  ah(async (_req, res) => {
    res.json(ok(await tunnelStatus()));
  }),
);

// Validate a CF token + return the accounts/zones the operator can pick from.
settingsRouter.post(
  '/tunnel/verify',
  ah(async (req, res) => {
    if (!process.env.TUNNEL_ENC_KEY) {
      return res.status(400).json(fail('no_enc_key', 'TUNNEL_ENC_KEY must be set to configure Cloudflare Tunnel'));
    }
    const body = tunnelVerifySchema.parse(req.body);
    try {
      await cfVerify(body.api_token);
      const accounts = await cfListAccounts(body.api_token);
      const zones = await cfListZones(body.api_token);
      res.json(ok({ accounts, zones }));
    } catch (err) {
      if (err instanceof CfError) return res.status(400).json(fail('cf_error', err.message));
      throw err;
    }
  }),
);

settingsRouter.post(
  '/tunnel/provision',
  ah(async (req: AuthedRequest, res) => {
    if (!process.env.TUNNEL_ENC_KEY) {
      return res.status(400).json(fail('no_enc_key', 'TUNNEL_ENC_KEY must be set to configure Cloudflare Tunnel'));
    }
    const body = tunnelProvisionSchema.parse(req.body);
    try {
      const result = await provisionTunnel({
        apiToken: body.api_token,
        accountId: body.account_id,
        zoneId: body.zone_id,
        zoneName: body.zone_name,
        tunnelName: body.tunnel_name,
        subdomain: body.subdomain,
      });
      await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: `Provisioned tunnel ${result.fqdn}` });
      res.json(ok(result));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await db.update(settings).set({ tunnelStatus: 'error', tunnelLastError: msg }).where(eq(settings.id, 1));
      if (err instanceof CfError) return res.status(502).json(fail('cf_error', msg));
      return res.status(500).json(fail('provision_failed', msg));
    }
  }),
);

settingsRouter.post(
  '/tunnel/disable',
  ah(async (req: AuthedRequest, res) => {
    await disableTunnel();
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'update', summary: 'Disabled Cloudflare Tunnel' });
    res.json(ok({ disabled: true }));
  }),
);

// ─── Backup & Restore ──────────────────────────────────────────────────────
import { createBackup, listBackups, deleteBackup, backupPath, restoreBackup } from '../services/backup.js';
import { createReadStream, statSync } from 'node:fs';
import { writeFile as writeFileAsync, mkdir as mkdirAsync } from 'node:fs/promises';
import { join as joinPath } from 'node:path';

settingsRouter.get(
  '/backups',
  ah(async (_req, res) => {
    const list = await listBackups();
    res.json(ok(list));
  }),
);

settingsRouter.post(
  '/backups',
  ah(async (req: AuthedRequest, res) => {
    const result = await createBackup();
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'export', summary: `Created backup ${result.filename}` });
    res.status(201).json(ok(result));
  }),
);

settingsRouter.get(
  '/backups/:filename/download',
  ah(async (req, res) => {
    const p = backupPath(req.params.filename);
    if (!existsSync(p)) throw new HttpError(404, 'not_found', 'Backup not found');
    const st = statSync(p);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    const stream = createReadStream(p);
    attachStreamErrorHandler(stream, res, { route: 'settings.backupDownload', filename: req.params.filename });
    stream.pipe(res);
  }),
);

settingsRouter.delete(
  '/backups/:filename',
  ah(async (req: AuthedRequest, res) => {
    await deleteBackup(req.params.filename);
    await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'delete', summary: `Deleted backup ${req.params.filename}` });
    res.json(ok({ deleted: true }));
  }),
);

const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

settingsRouter.post(
  '/restore',
  restoreUpload.single('file'),
  ah(async (req: AuthedRequest, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'No backup file uploaded');
    const confirm = String(req.body?.confirm ?? '');
    if (confirm !== 'REPLACE ALL DATA') {
      return res.status(400).json(fail('not_confirmed', 'Restore requires confirm="REPLACE ALL DATA"'));
    }
    // Stash the upload to a temp path before restoring (tar lib reads from disk).
    const { tmpdir } = await import('node:os');
    const tmp = joinPath(tmpdir(), `darrow-restore-${Date.now()}.tar.gz`);
    await mkdirAsync(joinPath(tmpdir()), { recursive: true }).catch(() => {});
    await writeFileAsync(tmp, req.file.buffer);
    try {
      await restoreBackup(tmp);
      await writeAudit({ userId: req.user?.id, entityType: 'settings', entityId: '1', action: 'import', summary: `Restored from backup ${req.file.originalname}` });
      res.json(ok({ restored: true }));
    } catch (err: any) {
      throw new HttpError(500, 'restore_failed', err?.message ?? String(err));
    } finally {
      await import('node:fs/promises').then((m) => m.rm(tmp, { force: true })).catch(() => {});
    }
  }),
);
