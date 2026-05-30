// Shared inbox ingestion used by both the authenticated inbox upload and the
// public (no-login) upload page. Content-sniffs, writes to inbox storage, creates
// the inbox_documents row, and enqueues image→PDF conversion.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { db, inboxDocuments } from '@darrow/db';
import { paths } from '../storage.js';
import { enqueueInboxToPdf } from '../queue.js';
import { hasHeicSupport } from '../media.js';

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const HEIC_MIMES = ['image/heic', 'image/heif'];

export interface IngestFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}
export interface IngestOpts {
  source: 'admin' | 'public';
  uploadedByUserId?: string | null;
  submittedJobCode?: string | null;
  notes?: string | null;
}

export async function ingestInboxFile(
  file: IngestFile,
  opts: IngestOpts,
): Promise<{ row?: any; rejected?: { filename: string; reason: string } }> {
  const ft = await fileTypeFromBuffer(file.buffer);
  const mime = ft?.mime ?? file.mimetype;
  const isPdf = mime === 'application/pdf';
  const isImage = IMAGE_MIMES.includes(mime);
  const isHeic = HEIC_MIMES.includes(mime);
  if (isHeic && !hasHeicSupport()) {
    return { rejected: { filename: file.originalname, reason: 'HEIC not supported — share as JPG or PDF' } };
  }
  if (!isPdf && !isImage && !isHeic) {
    return { rejected: { filename: file.originalname, reason: `Unsupported file type ${mime}` } };
  }
  const id = randomUUID();
  const common = {
    id,
    originalFilename: file.originalname,
    contentType: mime,
    fileSizeBytes: file.size,
    submittedJobCode: opts.submittedJobCode?.trim() || null,
    notes: opts.notes?.trim() || null,
    source: opts.source,
    uploadedByUserId: opts.uploadedByUserId ?? null,
  };
  if (isPdf) {
    const dest = join(paths.inboxDir(id), `${id}.pdf`);
    writeFileSync(dest, file.buffer, { mode: 0o600 });
    const [row] = await db.insert(inboxDocuments).values({ ...common, storedPath: dest, status: 'ready' }).returning();
    return { row };
  }
  const ext = (extname(file.originalname) || `.${ft?.ext ?? 'img'}`).toLowerCase();
  const pendingPath = join(paths.inboxPending(id), `${id}${ext}`);
  writeFileSync(pendingPath, file.buffer, { mode: 0o600 });
  const [row] = await db.insert(inboxDocuments).values({ ...common, storedPath: pendingPath, status: 'pending' }).returning();
  await enqueueInboxToPdf(id);
  return { row };
}
