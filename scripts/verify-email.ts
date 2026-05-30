/* Proves per-user email: a minimal SMTP sink captures MAIL FROM + From header
 * when the real send-email worker delivers an invoice for a user whose personal
 * SMTP From is alice@firm.test. Run: npx tsx scripts/verify-email.ts */
import net from 'node:net';
import { createApp } from '../apps/api/src/app.js';
import { startSendEmailWorker } from '../packages/workers/src/send-email.js';
import { startImageToPdfWorker } from '../packages/workers/src/image-to-pdf.js';
import { startRenderDocxWorker } from '../packages/workers/src/render-docx.js';
import { startDocxToPdfWorker } from '../packages/workers/src/docx-to-pdf.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 4188;
const SMTP_PORT = 2526;
const BASE = `http://localhost:${PORT}/api`;
let cookie = '';
const captured: { mailFrom?: string; rcptTo?: string; fromHeader?: string; replyTo?: string } = {};

function startSink(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let inData = false;
      sock.write('220 sink ready\r\n');
      sock.on('data', (buf) => {
        for (const line of buf.toString().split('\r\n')) {
          if (!line) continue;
          if (inData) {
            if (line === '.') { inData = false; sock.write('250 OK queued\r\n'); continue; }
            const mf = /^From:\s*(.*)$/i.exec(line); if (mf) captured.fromHeader = mf[1];
            const rt = /^Reply-To:\s*(.*)$/i.exec(line); if (rt) captured.replyTo = rt[1];
            continue;
          }
          const u = line.toUpperCase();
          if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250 hello\r\n');
          else if (u.startsWith('MAIL FROM')) { captured.mailFrom = /<([^>]*)>/.exec(line)?.[1]; sock.write('250 OK\r\n'); }
          else if (u.startsWith('RCPT TO')) { captured.rcptTo = /<([^>]*)>/.exec(line)?.[1]; sock.write('250 OK\r\n'); }
          else if (u.startsWith('DATA')) { inData = true; sock.write('354 send data\r\n'); }
          else if (u.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 OK\r\n');
        }
      });
    });
    server.listen(SMTP_PORT, () => resolve(server));
  });
}

async function call(method: string, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = { 'X-Requested-With': 'darrow' };
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const json = await res.json();
  if (json.ok === false) throw new Error(`${method} ${path} -> ${json.error.code}: ${json.error.message}`);
  return json.data ?? json;
}

async function main() {
  const pw = process.env.SMOKE_PW ?? (existsSync('docs/FIRST_RUN.md') ? readFileSync('docs/FIRST_RUN.md', 'utf8').match(/Password: `([^`]+)`/)?.[1] : undefined);
  if (!pw) throw new Error('no admin password');
  const sink = await startSink();
  const app = createApp();
  const server = app.listen(PORT);
  startSendEmailWorker(); startImageToPdfWorker(); startRenderDocxWorker(); startDocxToPdfWorker();
  await new Promise((r) => setTimeout(r, 400));

  await call('POST', '/auth/login', { username: 'admin', password: pw });
  // upload template so generation works
  const tpl = join(process.cwd(), 'docs', 'example-template.docx');
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(tpl)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'template.docx');
  await fetch(`${BASE}/settings/template`, { method: 'POST', headers: { 'X-Requested-With': 'darrow', cookie }, body: fd });
  await call('PUT', '/settings', { company_name: 'Darrow Electric', address_line1: '1', city: 'J', state: 'MO', zip: '64801', phone: '', email: '' });

  // give the admin user a personal SMTP From riding this sink (no host -> would need global;
  // so set the user's own host = sink to exercise the per-user creds path)
  await call('PUT', '/auth/smtp', { smtp_host: 'localhost', smtp_port: SMTP_PORT, smtp_from_address: 'alice@firm.test', smtp_from_name: 'Alice Field', smtp_enabled: true });

  // build a finalized invoice
  const sfx = Date.now().toString().slice(-6);
  const cust = await call('POST', '/customers', { name: `Mail Co ${sfx}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' });
  const levels = await call('GET', '/rate-levels'); const lid = levels.find((l: any) => l.name === 'Journeyman').id;
  const sched = await call('POST', `/customers/${cust.id}/rate-schedules`, { name: 'S', effective_from: '2024-01-01' });
  await call('POST', `/rate-schedules/${sched.id}/lines/bulk`, [{ level_id: lid, rate_1x: 100, rate_15x: 150, rate_2x: 200 }]);
  await call('PUT', `/rate-schedules/${sched.id}/set-default`);
  const emp = await call('POST', '/employees', { name: `Mail Tech ${sfx}`, level_id: lid });
  await call('POST', `/employees/${emp.id}/cost-rates`, { effective_from: '2024-01-01', cost_st: 40, cost_ot: 60, cost_dt: 80 });
  const job = await call('POST', '/jobs', { code: `D26ML${sfx}`, customer_id: cust.id, description: 'mail' });
  await call('POST', '/time/entries', { employee_id: emp.id, job_id: job.id, work_date: '2024-02-01', st_hours: 8, ot_hours: 0, dt_hours: 0 });
  const draft = await call('POST', '/invoices/draft', { job_id: job.id, through_date: '2024-12-31' });
  const fin = await call('POST', `/invoices/${draft.id}/finalize`);

  // wait for docx + pdf generation
  for (let i = 0; i < 40; i++) {
    const d = await call('GET', `/invoices/${draft.id}`);
    if (d.invoice.docx_status === 'ready' && d.invoice.pdf_status === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // send the email (attach the PDF)
  await call('POST', `/invoices/${draft.id}/email`, { to: 'client@customer.test', cc: [], subject: `Invoice ${fin.billed_reference}`, body: 'See attached.', include_docx: false, include_pdf: true });

  // wait for the worker to deliver
  for (let i = 0; i < 30 && !captured.mailFrom; i++) await new Promise((r) => setTimeout(r, 500));

  const ok = captured.mailFrom === 'alice@firm.test' && (captured.fromHeader ?? '').includes('alice@firm.test') && captured.rcptTo === 'client@customer.test';
  console.log('captured:', JSON.stringify(captured));
  console.log(ok ? '\n\x1b[32m✓ EMAIL appears to come directly from the user (alice@firm.test)\x1b[0m' : '\n\x1b[31m✗ envelope mismatch\x1b[0m');
  sink.close(); server.close();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('verify-email failed', e); process.exit(1); });
