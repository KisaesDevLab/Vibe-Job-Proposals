/**
 * Single-process end-to-end smoke test (Phase 20 SMOKETEST programmatic form).
 * Starts the API server AND the BullMQ workers in THIS process (no detached
 * children, so it survives the build sandbox), then drives the full invoice
 * lifecycle over real HTTP: login -> customer -> rate schedule -> employee ->
 * cost rate -> job -> time -> expense + image attachment (converted by the real
 * image-to-pdf worker) -> draft -> finalize (docx+pdf via real workers) ->
 * download both -> reports -> readiness -> void -> reissue.
 *
 * Run: npx tsx scripts/smoke.ts
 */
import { createApp } from '../apps/api/src/app.js';
import { startImageToPdfWorker } from '../packages/workers/src/image-to-pdf.js';
import { startRenderDocxWorker } from '../packages/workers/src/render-docx.js';
import { startDocxToPdfWorker } from '../packages/workers/src/docx-to-pdf.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import sharpLib from 'sharp';

const PORT = 4137;
const BASE = `http://localhost:${PORT}/api`;
let cookie = '';

async function call(method: string, path: string, body?: any, raw = false): Promise<any> {
  const headers: Record<string, string> = { 'X-Requested-With': 'darrow' };
  if (cookie) headers.cookie = cookie;
  let payload: any;
  if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const json = await res.json();
  if (json.ok === false) throw new Error(`${method} ${path} -> ${json.error.code}: ${json.error.message} ${JSON.stringify(json.error.details ?? '')}`);
  return json.data ?? json;
}

async function uploadImage(expenseId: string, file: string): Promise<any> {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)], { type: 'image/png' }), 'receipt.png');
  const res = await fetch(`${BASE}/expenses/${expenseId}/attachments`, { method: 'POST', headers: { 'X-Requested-With': 'darrow', cookie }, body: fd });
  const json = await res.json();
  if (json.ok === false) throw new Error(JSON.stringify(json.error));
  return json.data;
}

async function poll(fn: () => Promise<boolean>, label: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const log = (s: string) => console.log(`\x1b[36m✓\x1b[0m ${s}`);

async function main() {
  // password from FIRST_RUN or env
  const pw = process.env.SMOKE_PW ?? (existsSync('docs/FIRST_RUN.md') ? readFileSync('docs/FIRST_RUN.md', 'utf8').match(/Password: `([^`]+)`/)?.[1] : undefined);
  if (!pw) throw new Error('no admin password (set SMOKE_PW or run bootstrap-admin)');

  const app = createApp();
  const server = app.listen(PORT);
  startImageToPdfWorker();
  startRenderDocxWorker();
  startDocxToPdfWorker();
  await new Promise((r) => setTimeout(r, 500));

  // make a test image
  await sharpLib({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toFile('/tmp/receipt.png');

  await call('POST', '/auth/login', { username: 'admin', password: pw });
  log('logged in');

  const suffix = Date.now().toString().slice(-6);
  const cust = await call('POST', '/customers', { name: `Smoke Co ${suffix}`, bill_to_address1: '1 Main', bill_to_city: 'Joplin', bill_to_state: 'MO', bill_to_zip: '64801' });
  const levels = await call('GET', '/rate-levels');
  const lid = levels.find((l: any) => l.name === 'Journeyman').id;
  const sched = await call('POST', `/customers/${cust.id}/rate-schedules`, { name: '2026', effective_from: '2026-01-01' });
  await call('POST', `/rate-schedules/${sched.id}/lines/bulk`, [{ level_id: lid, rate_1x: 110, rate_15x: 165, rate_2x: 220 }]);
  await call('PUT', `/rate-schedules/${sched.id}/set-default`);
  log('customer + rate schedule');

  const emp = await call('POST', '/employees', { name: `Smoke Tech ${suffix}`, level_id: lid });
  await call('POST', `/employees/${emp.id}/cost-rates`, { effective_from: '2026-01-01', cost_st: 45, cost_ot: 67.5, cost_dt: 90 });
  log('employee + cost rate');

  const job = await call('POST', '/jobs', { code: `D26SMK${suffix}`, customer_id: cust.id, description: 'Smoke rewire' });
  await call('POST', '/time/entries', { employee_id: emp.id, job_id: job.id, work_date: '2026-05-11', st_hours: 8, ot_hours: 4, dt_hours: 0 });
  await call('POST', '/time/entries', { employee_id: emp.id, job_id: job.id, work_date: '2026-05-12', st_hours: 8, ot_hours: 0, dt_hours: 0 });
  log('job + time entries');

  const exp = await call('POST', '/expenses', { work_date: '2026-05-11', job_id: job.id, vendor: 'Graybar', amount: 425.5, category: 'materials' });
  const att = await uploadImage(exp.id, '/tmp/receipt.png');
  await poll(async () => (await call('GET', `/expenses/${exp.id}`)).attachments.find((a: any) => a.id === att.id)?.status === 'ready', 'attachment conversion');
  log('expense + image attachment converted to PDF');

  const draft = await call('POST', '/invoices/draft', { job_id: job.id, through_date: '2026-05-29' });
  const detail = await call('GET', `/invoices/${draft.id}`);
  if (detail.preview.blockers.length) throw new Error('unexpected blockers: ' + JSON.stringify(detail.preview.blockers));
  log(`draft created (preview grand total $${detail.preview.totals.grand_total})`);

  const fin = await call('POST', `/invoices/${draft.id}/finalize`);
  log(`finalized as ${fin.billed_reference}`);

  await poll(async () => {
    const d = await call('GET', `/invoices/${draft.id}`);
    return d.invoice.docx_status === 'ready' && d.invoice.pdf_status === 'ready';
  }, 'docx+pdf generation', 60);
  log('docx + pdf generated');

  const docxRes = await call('GET', `/invoices/${draft.id}/docx`, undefined, true);
  const pdfRes = await call('GET', `/invoices/${draft.id}/pdf`, undefined, true);
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  writeFileSync('/tmp/smoke-invoice.docx', docxBuf);
  writeFileSync('/tmp/smoke-invoice.pdf', pdfBuf);
  if (pdfBuf.subarray(0, 5).toString() !== '%PDF-') throw new Error('pdf invalid');
  if (docxBuf.subarray(0, 2).toString() !== 'PK') throw new Error('docx invalid');
  // guard against the dotted-placeholder regression: scalars must render into the docx
  const { default: PizZip } = await import('pizzip');
  const docXmlText = new PizZip(docxBuf).file('word/document.xml')!.asText().replace(/<[^>]+>/g, '');
  for (const needle of [fin.billed_reference, 'Smoke Co', '$2,909.33']) {
    if (!docXmlText.includes(needle)) throw new Error(`docx missing rendered value "${needle}" (placeholder regression)`);
  }
  log(`downloaded docx (${docxBuf.length}b) + pdf (${pdfBuf.length}b); scalars rendered`);

  const r1 = await call('GET', `/reports/employee-hours?job_id=${job.id}`);
  const r2 = await call('GET', `/reports/time-detail?job_id=${job.id}`);
  const r3 = await call('GET', `/reports/expense-list?job_id=${job.id}`);
  log(`reports: employee-hours(${r1.length}) time-detail(${r2.length}) expense-list(${r3.length})`);

  const ready = await call('GET', '/reports/readiness');
  log(`readiness: ${Object.entries(ready).map(([k, v]: any) => `${k}=${v.count}`).join(' ')}`);

  await call('POST', `/invoices/${draft.id}/void`, { reason: 'smoke reissue' });
  const draft2 = await call('POST', '/invoices/draft', { job_id: job.id, through_date: '2026-05-29' });
  const fin2 = await call('POST', `/invoices/${draft2.id}/finalize`);
  if (fin2.sequence_number !== 2) throw new Error(`expected sequence 2, got ${fin2.sequence_number}`);
  log(`voided + reissued as ${fin2.billed_reference} (sequence ${fin2.sequence_number})`);

  console.log('\n\x1b[32m✓✓✓ SMOKE TEST PASSED\x1b[0m');
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n\x1b[31m✗ SMOKE FAILED:\x1b[0m', err.message);
  process.exit(1);
});
