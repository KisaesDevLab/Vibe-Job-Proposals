// render-package worker. Composes the full invoice package PDF:
//   1) react-pdf renders pages 1-4 to an in-memory PDF buffer
//   2) pdf-lib loads that buffer + each ready expense attachment (sorted by
//      expense work_date then vendor) and concatenates them into the final
//      package PDF saved at /storage/invoices/{invoiceId}.package.pdf
import { Worker } from 'bullmq';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import { createElement } from 'react';
import { sql } from '@darrow/db';
import { connection, logger, STORAGE } from './connection.js';
import { buildPackageData } from './package-data.js';
import { PackageDocument } from './package-pdf.js';

async function render(invoiceId: string): Promise<void> {
  const data = await buildPackageData(invoiceId);

  // 1) render cover pages — pass a placeholder total page count first; we'll
  // re-render after the merge below if we need an exact "1 of N" footer.
  // For now we hard-code "1 of 5" feel by using estimated cover count + attachments.
  const coverPageEstimate = 1 + 1 + (data.dailyGrid.length ? 1 : 0) + (data.expenseLog.length ? 1 : 0);
  const attPageCount = await countAttachmentPages(data.attachments);
  const totalPages = coverPageEstimate + attPageCount;

  const coverBuf = await renderToBuffer(createElement(PackageDocument, { data, totalPages }) as any);

  // 2) merge with attachments using pdf-lib.
  const out = await PDFDocument.create();
  const cover = await PDFDocument.load(coverBuf);
  const coverPages = await out.copyPages(cover, cover.getPageIndices());
  for (const p of coverPages) out.addPage(p);

  for (const att of data.attachments) {
    if (!att.storedPath || !existsSync(att.storedPath)) {
      logger.warn('render-package skipping missing attachment', { invoiceId, attachmentId: att.attachmentId, storedPath: att.storedPath });
      continue;
    }
    try {
      const src = await PDFDocument.load(readFileSync(att.storedPath));
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    } catch (err) {
      // A corrupt attachment shouldn't kill the package; log and continue so
      // the user at least gets the cover pages they can review.
      logger.error('render-package failed to merge attachment', {
        invoiceId, attachmentId: att.attachmentId, err: String(err),
      });
    }
  }

  const bytes = await out.save();
  const dir = join(STORAGE, 'invoices');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const outPath = join(dir, `${invoiceId}.package.pdf`);
  writeFileSync(outPath, bytes, { mode: 0o600 });

  await sql`UPDATE invoices SET generated_package_path=${outPath}, package_status='ready', package_error=NULL WHERE id=${invoiceId}`;
  logger.info('render-package done', { invoiceId, outPath, sizeBytes: bytes.length, attachments: data.attachments.length });
}

async function countAttachmentPages(attachments: { storedPath: string }[]): Promise<number> {
  let n = 0;
  for (const a of attachments) {
    if (!a.storedPath || !existsSync(a.storedPath)) continue;
    try {
      const doc = await PDFDocument.load(readFileSync(a.storedPath));
      n += doc.getPageCount();
    } catch (err) {
      // Counted as 0 pages (the merge step skips it too), but log for context
      // rather than swallowing silently.
      logger.warn('render-package: could not count pages for attachment', { path: a.storedPath, err: String(err) });
    }
  }
  return n;
}

export function startRenderPackageWorker(): Worker {
  const worker = new Worker('render-package', async (job) => render(job.data.invoiceId), { connection, concurrency: 1 });
  worker.on('failed', async (job, err) => {
    logger.error('render-package failed', { invoiceId: job?.data?.invoiceId, err: String(err), attempts: job?.attemptsMade });
    try {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
        await sql`UPDATE invoices SET package_status='failed', package_error=${String(err).slice(0, 300)} WHERE id=${job.data.invoiceId}`;
      }
    } catch (dbErr) {
      logger.error('render-package failed-handler could not persist status', { invoiceId: job?.data?.invoiceId, err: String(dbErr) });
    }
  });
  worker.on('error', (err) => logger.error('render-package worker error', { err: String(err) }));
  return worker;
}
