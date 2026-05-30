// Public (no-login) endpoints — gated by PUBLIC_UPLOAD_TOKEN. Mounted BEFORE the
// requireAuth barrier. The only capability is dropping bills into the inbox.
import { Router } from 'express';
import multer from 'multer';
import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { ok, fail } from '@darrow/shared';
import { redis } from '../redis.js';
import { config } from '../config.js';
import { ah } from '../error-handler.js';
import { ingestInboxFile } from '../services/inbox-ingest.js';
import { writeAudit } from '../audit.js';

export const publicRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function tokenOk(provided: unknown): boolean {
  const expected = config.PUBLIC_UPLOAD_TOKEN;
  if (!expected) return false; // feature disabled when no token configured
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
  message: fail('rate_limited', 'Too many uploads; please try again later'),
});

// Lets the page show "valid link" vs "invalid/expired" before rendering the form.
publicRouter.get('/upload/check', (req, res) => {
  if (!config.PUBLIC_UPLOAD_TOKEN) return res.status(404).json(fail('disabled', 'Public uploads are disabled'));
  const token = req.query.k ?? req.get('x-upload-token');
  if (!tokenOk(token)) return res.status(401).json(fail('invalid_token', 'Invalid or missing upload link'));
  res.json(ok({ ok: true }));
});

// POST /api/public/upload?k=TOKEN — drop bills into the inbox with optional
// job-code hint + notes. No authentication; the token is the gate.
publicRouter.post(
  '/upload',
  uploadLimiter,
  upload.array('files', 20),
  ah(async (req, res) => {
    if (!config.PUBLIC_UPLOAD_TOKEN) return res.status(404).json(fail('disabled', 'Public uploads are disabled'));
    const token = req.query.k ?? req.get('x-upload-token');
    if (!tokenOk(token)) return res.status(401).json(fail('invalid_token', 'Invalid or missing upload link'));

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) return res.status(400).json(fail('no_file', 'No files uploaded'));
    const jobCode = typeof req.body?.job_code === 'string' ? req.body.job_code.slice(0, 60) : null;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 1000) : null;

    const created: any[] = [];
    const rejected: { filename: string; reason: string }[] = [];
    for (const file of files) {
      const r = await ingestInboxFile(file, { source: 'public', submittedJobCode: jobCode, notes });
      if (r.row) created.push({ id: r.row.id, original_filename: r.row.originalFilename, status: r.row.status });
      if (r.rejected) rejected.push(r.rejected);
    }
    await writeAudit({ userId: null, entityType: 'inbox', entityId: 'public', action: 'create', summary: `Public upload of ${created.length} bill(s)${jobCode ? ` for ${jobCode}` : ''}` });
    res.status(201).json(ok({ created: created.length, rejected }));
  }),
);
