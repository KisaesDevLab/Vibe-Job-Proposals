import { startImageToPdfWorker } from './image-to-pdf.js';
import { startInboxToPdfWorker } from './inbox-to-pdf.js';
import { startRenderDocxWorker } from './render-docx.js';
import { startDocxToPdfWorker } from './docx-to-pdf.js';
import { startRenderPackageWorker } from './render-package.js';
import { startRenderSummaryPdfWorker } from './render-summary-pdf.js';
import { startSendEmailWorker } from './send-email.js';
import { convertDocxToPdf } from './docx-to-pdf.js';
import { logger } from './connection.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// One-time LibreOffice smoke conversion at boot (Phase 15 task 11).
async function loSmoke(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lo-smoke-'));
  try {
    // Minimal valid docx via docxtemplater on an empty template is heavy; instead
    // ship a tiny prebuilt docx zip.
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.folder('_rels')!.file('.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder('word')!.file('document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>smoke</w:t></w:r></w:p></w:body></w:document>');
    void Docxtemplater;
    const docx = join(dir, 'smoke.docx');
    writeFileSync(docx, zip.generate({ type: 'nodebuffer' }));
    await convertDocxToPdf(docx, dir);
    logger.info('LibreOffice smoke conversion OK');
  } catch (err) {
    logger.error('LibreOffice smoke conversion FAILED — pdf generation may not work', { err: String(err) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await loSmoke();
  startImageToPdfWorker();
  startInboxToPdfWorker();
  startRenderDocxWorker();
  startDocxToPdfWorker();
  startRenderPackageWorker();
  startRenderSummaryPdfWorker();
  startSendEmailWorker();
  logger.info('workers started', { queues: ['image-to-pdf', 'inbox-to-pdf', 'render-docx', 'docx-to-pdf', 'render-package', 'render-summary-pdf', 'send-invoice-email'] });
}

main().catch((err) => {
  logger.error('workers fatal', { err: String(err) });
  process.exit(1);
});
