// render-docx worker (Phase 14). Renders the uploaded template with the
// snapshot data object; on success enqueues docx-to-pdf.
import { Worker } from 'bullmq';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { sql } from '@darrow/db';
import { connection, logger, STORAGE } from './connection.js';
import { buildInvoiceData } from './invoice-data.js';
import { enqueueDocxToPdf } from './queues.js';

async function render(invoiceId: string): Promise<void> {
  const [settings] = await sql<any[]>`SELECT template_docx_path FROM settings WHERE id=1`;
  const templatePath = settings?.template_docx_path;
  if (!templatePath || !existsSync(templatePath)) {
    throw new Error('No invoice template uploaded (Settings → Branding)');
  }
  const data = await buildInvoiceData(invoiceId);
  const zip = new PizZip(readFileSync(templatePath));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '', // missing placeholders render empty
  });
  doc.render(data);
  const buf = doc.getZip().generate({ type: 'nodebuffer' });

  const dir = join(STORAGE, 'invoices');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = join(dir, `${invoiceId}.docx`);
  writeFileSync(out, buf, { mode: 0o600 });
  if (buf.length > 10 * 1024 * 1024) logger.warn('generated docx > 10MB (possible runaway loop)', { invoiceId, size: buf.length });
  await sql`UPDATE invoices SET generated_docx_path=${out}, docx_status='ready' WHERE id=${invoiceId}`;
  logger.info('render-docx done', { invoiceId, out });
  await enqueueDocxToPdf(invoiceId);
}

export function startRenderDocxWorker(): Worker {
  const worker = new Worker('render-docx', async (job) => render(job.data.invoiceId), { connection, concurrency: 1 });
  worker.on('failed', async (job, err) => {
    logger.error('render-docx failed', { invoiceId: job?.data?.invoiceId, err: String(err), attempts: job?.attemptsMade });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await sql`UPDATE invoices SET docx_status='failed', generation_error=${String(err)} WHERE id=${job.data.invoiceId}`;
    }
  });
  return worker;
}
