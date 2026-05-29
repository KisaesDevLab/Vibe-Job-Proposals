// image-to-pdf worker (Phase 10). Loads image via sharp (auto-orient), embeds
// into a single-page A4 PDF via pdf-lib at native size (max 80% of page).
import { Worker } from 'bullmq';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { db, expenseAttachments } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { connection, logger } from './connection.js';

const A4 = { w: 595.28, h: 841.89 }; // points

async function convert(attachmentId: string): Promise<void> {
  const sharp = (await import('sharp')).default;
  const [att] = await db.select().from(expenseAttachments).where(eq(expenseAttachments.id, attachmentId));
  if (!att) throw new Error(`attachment ${attachmentId} not found`);
  const src = att.storedPath;
  if (!existsSync(src)) throw new Error(`source missing ${src}`);

  // normalize + auto-rotate -> PNG buffer
  const img = sharp(readFileSync(src)).rotate();
  const png = await img.png().toBuffer();
  const meta = await sharp(png).metadata();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);
  const embedded = await pdf.embedPng(png);
  const maxW = A4.w * 0.8;
  const maxH = A4.h * 0.8;
  const iw = meta.width ?? embedded.width;
  const ih = meta.height ?? embedded.height;
  const scale = Math.min(maxW / iw, maxH / ih, 1);
  const w = iw * scale;
  const h = ih * scale;
  page.drawImage(embedded, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  const bytes = await pdf.save();

  const finalDir = dirname(dirname(src)); // .../expenses/{id}/_pending -> .../expenses/{id}
  const finalPath = join(finalDir, `${attachmentId}.pdf`);
  writeFileSync(finalPath, bytes, { mode: 0o600 });
  if (existsSync(src)) unlinkSync(src);
  await db
    .update(expenseAttachments)
    .set({ status: 'ready', storedPath: finalPath, contentType: 'application/pdf' })
    .where(eq(expenseAttachments.id, attachmentId));
  logger.info('image-to-pdf done', { attachmentId, finalPath });
}

export function startImageToPdfWorker(): Worker {
  const worker = new Worker(
    'image-to-pdf',
    async (job) => convert(job.data.attachmentId),
    { connection, concurrency: 2 },
  );
  worker.on('failed', async (job, err) => {
    logger.error('image-to-pdf failed', { id: job?.data?.attachmentId, err: String(err), attempts: job?.attemptsMade });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await db.update(expenseAttachments).set({ status: 'failed', retryCount: job.attemptsMade }).where(eq(expenseAttachments.id, job.data.attachmentId));
    }
  });
  return worker;
}
