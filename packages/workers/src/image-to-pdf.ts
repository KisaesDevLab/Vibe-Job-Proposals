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

/**
 * Pure core: normalize + auto-rotate an image buffer and embed it into a
 * single-page A4 PDF at native size (max 80% of the page). Testable without DB.
 */
export async function imageBufferToPdf(input: Buffer): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;
  const png = await sharp(input).rotate().png().toBuffer();
  const meta = await sharp(png).metadata();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);
  const embedded = await pdf.embedPng(png);
  const iw = meta.width ?? embedded.width;
  const ih = meta.height ?? embedded.height;
  const scale = Math.min((A4.w * 0.8) / iw, (A4.h * 0.8) / ih, 1);
  const w = iw * scale;
  const h = ih * scale;
  page.drawImage(embedded, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  return pdf.save();
}

async function convert(attachmentId: string): Promise<void> {
  const [att] = await db.select().from(expenseAttachments).where(eq(expenseAttachments.id, attachmentId));
  if (!att) throw new Error(`attachment ${attachmentId} not found`);
  const src = att.storedPath;
  if (!existsSync(src)) throw new Error(`source missing ${src}`);

  const bytes = await imageBufferToPdf(readFileSync(src));

  const finalDir = dirname(dirname(src)); // .../expenses/{id}/_pending -> .../expenses/{id}
  const finalPath = join(finalDir, `${attachmentId}.pdf`);
  writeFileSync(finalPath, bytes, { mode: 0o600 });
  // Point the row at the final PDF BEFORE deleting the pending source. If this
  // update fails, the source survives so a BullMQ retry re-runs cleanly;
  // deleting first would strand the attachment ("source missing") on retry.
  await db
    .update(expenseAttachments)
    .set({ status: 'ready', storedPath: finalPath, contentType: 'application/pdf' })
    .where(eq(expenseAttachments.id, attachmentId));
  try {
    if (existsSync(src)) unlinkSync(src);
  } catch (err) {
    logger.warn('image-to-pdf: pending source cleanup failed (attachment already ready)', { attachmentId, src, err: String(err) });
  }
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
    try {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        await db.update(expenseAttachments).set({ status: 'failed', retryCount: job.attemptsMade }).where(eq(expenseAttachments.id, job.data.attachmentId));
      }
    } catch (dbErr) {
      logger.error('image-to-pdf failed-handler could not persist status', { id: job?.data?.attachmentId, err: String(dbErr) });
    }
  });
  worker.on('error', (err) => logger.error('image-to-pdf worker error', { err: String(err) }));
  return worker;
}
