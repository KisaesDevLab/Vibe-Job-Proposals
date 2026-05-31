// docx-to-pdf worker (Phase 15). Headless LibreOffice with per-job HOME isolation.
import { Worker } from 'bullmq';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { sql } from '@darrow/db';
import { connection, logger, STORAGE } from './connection.js';

const execFileP = promisify(execFile);
const LO = process.env.LIBREOFFICE_BIN ?? '/usr/bin/libreoffice';

export async function convertDocxToPdf(docxPath: string, outDir: string): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'lo-'));
  try {
    await execFileP(LO, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', home, docxPath], {
      env: { ...process.env, HOME: home },
      timeout: 60_000,
    });
    const produced = join(home, basename(docxPath).replace(/\.docx$/i, '.pdf'));
    if (!existsSync(produced)) throw new Error('LibreOffice did not produce a PDF');
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const finalPath = join(outDir, basename(produced));
    copyFileSync(produced, finalPath);
    return finalPath;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function run(invoiceId: string): Promise<void> {
  const [inv] = await sql<any[]>`SELECT generated_docx_path FROM invoices WHERE id=${invoiceId}`;
  if (!inv?.generated_docx_path || !existsSync(inv.generated_docx_path)) throw new Error('docx not found');
  const finalPath = await convertDocxToPdf(inv.generated_docx_path, join(STORAGE, 'invoices'));
  await sql`UPDATE invoices SET generated_pdf_path=${finalPath}, pdf_status='ready' WHERE id=${invoiceId}`;
  logger.info('docx-to-pdf done', { invoiceId, finalPath });
}

export function startDocxToPdfWorker(): Worker {
  const worker = new Worker('docx-to-pdf', async (job) => run(job.data.invoiceId), { connection, concurrency: 1 });
  worker.on('failed', async (job, err) => {
    logger.error('docx-to-pdf failed', { invoiceId: job?.data?.invoiceId, err: String(err), attempts: job?.attemptsMade });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
      await sql`UPDATE invoices SET pdf_status='failed', generation_error=${String(err)} WHERE id=${job.data.invoiceId}`;
    }
  });
  return worker;
}
