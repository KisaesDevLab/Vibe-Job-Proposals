// inbox-to-pdf worker — converts an uploaded bill image in the processing inbox
// into a single-page PDF (mirrors image-to-pdf.ts for expense attachments).
import { Worker } from 'bullmq';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { db, inboxDocuments } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { connection, logger } from './connection.js';
import { imageBufferToPdf } from './image-to-pdf.js';

async function convert(docId: string): Promise<void> {
  const [doc] = await db.select().from(inboxDocuments).where(eq(inboxDocuments.id, docId));
  if (!doc) throw new Error(`inbox document ${docId} not found`);
  const src = doc.storedPath;
  if (!existsSync(src)) throw new Error(`source missing ${src}`);

  const bytes = await imageBufferToPdf(readFileSync(src));
  const finalDir = dirname(dirname(src)); // .../inbox/{id}/_pending -> .../inbox/{id}
  const finalPath = join(finalDir, `${docId}.pdf`);
  writeFileSync(finalPath, bytes, { mode: 0o600 });
  // Update the row before deleting the pending source so a retry after a failed
  // update re-runs cleanly instead of hitting "source missing".
  await db
    .update(inboxDocuments)
    .set({ status: 'ready', storedPath: finalPath, contentType: 'application/pdf' })
    .where(eq(inboxDocuments.id, docId));
  try {
    if (existsSync(src)) unlinkSync(src);
  } catch (err) {
    logger.warn('inbox-to-pdf: pending source cleanup failed (doc already ready)', { docId, src, err: String(err) });
  }
  logger.info('inbox-to-pdf done', { docId, finalPath });
}

export function startInboxToPdfWorker(): Worker {
  const worker = new Worker('inbox-to-pdf', async (job) => convert(job.data.docId), { connection, concurrency: 2 });
  worker.on('failed', async (job, err) => {
    logger.error('inbox-to-pdf failed', { id: job?.data?.docId, err: String(err), attempts: job?.attemptsMade });
    try {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        await db.update(inboxDocuments).set({ status: 'failed', retryCount: job.attemptsMade }).where(eq(inboxDocuments.id, job.data.docId));
      }
    } catch (dbErr) {
      logger.error('inbox-to-pdf failed-handler could not persist status', { id: job?.data?.docId, err: String(dbErr) });
    }
  });
  worker.on('error', (err) => logger.error('inbox-to-pdf worker error', { err: String(err) }));
  return worker;
}
