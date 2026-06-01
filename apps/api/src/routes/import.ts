import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ok, fail } from '@darrow/shared';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { previewImport, commitImport, IMPORTER_TYPES, type ImportType } from '../services/import-xlsx.js';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const TYPES: ReadonlyArray<ImportType> = ['expenses', 'customers', 'jobs', 'time-entries'] as const;

importRouter.get('/types', ah(async (_req, res) => {
  res.json(ok(IMPORTER_TYPES));
}));

importRouter.post(
  '/preview',
  upload.single('file'),
  ah(async (req, res) => {
    const type = String(req.query.type ?? '');
    if (!TYPES.includes(type as ImportType)) throw new HttpError(400, 'bad_type', `type must be one of: ${TYPES.join(', ')}`);
    if (!req.file) throw new HttpError(400, 'no_file', 'No file uploaded');
    try {
      const result = await previewImport(type as ImportType, req.file.buffer);
      res.json(ok(result));
    } catch (err: any) {
      return res.status(400).json(fail('parse_failed', err?.message ?? String(err)));
    }
  }),
);

const commitSchema = z.object({
  rows: z.array(z.any()).min(1),
});

importRouter.post(
  '/commit',
  ah(async (req: AuthedRequest, res) => {
    const type = String(req.query.type ?? '');
    if (!TYPES.includes(type as ImportType)) throw new HttpError(400, 'bad_type', `type must be one of: ${TYPES.join(', ')}`);
    const { rows } = commitSchema.parse(req.body);
    // Drop rows the UI flagged with validation errors (they're filtered out
    // already, but defensive). The preview path is the source of truth for
    // what's actually committable.
    const clean = rows.filter((r: any) => !r._errors || r._errors.length === 0);
    if (clean.length === 0) return res.status(400).json(fail('no_valid_rows', 'No rows to import after validation'));
    const result = await commitImport(type as ImportType, clean, req.user?.id ?? null);
    res.json(ok(result));
  }),
);
