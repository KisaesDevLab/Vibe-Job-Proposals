/* Exhaustive endpoint audit — probes routes across all phases in-process and
 * reports PASS/FAIL so we can find real runtime bugs. Not a vitest test. */
import { createApp } from '../apps/api/src/app.js';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { sql } from '@darrow/db';

const app = createApp();
let agent: ReturnType<typeof request.agent>;
const H = (t: any) => t.set('X-Requested-With', 'darrow');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; }
  else { fail++; fails.push(`${name} ${extra}`); console.log(`  ✗ ${name} ${extra}`); }
}

async function main() {
  const s = Date.now().toString().slice(-7);
  const hash = await bcrypt.hash('audit-pw-1234567890', 12);
  await sql`INSERT INTO users (username,password_hash,role) VALUES ('auditor',${hash},'admin') ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash`;
  agent = request.agent(app);

  // Phase 2 auth
  check('login', (await H(agent.post('/api/auth/login')).send({ username: 'auditor', password: 'audit-pw-1234567890' })).status === 200);
  check('change-password rejects short', (await H(agent.post('/api/auth/change-password')).send({ currentPassword: 'audit-pw-1234567890', newPassword: 'short' })).status === 400);
  check('audit list (admin)', (await agent.get('/api/audit?entity_type=customer')).status === 200);

  // Phase 4 rate levels
  const rl = await agent.get('/api/rate-levels'); check('rate-levels list', rl.status === 200 && rl.body.data.length >= 9);
  const newLvl = await H(agent.post('/api/rate-levels')).send({ name: `Temp ${s}` });
  check('rate-level create', newLvl.status === 201);
  const reorder = await H(agent.patch('/api/rate-levels/reorder')).send([{ id: newLvl.body.data.id, sort_order: 99 }]);
  check('rate-level reorder', reorder.status === 200);
  check('rate-level delete (unused) ok', (await H(agent.del(`/api/rate-levels/${newLvl.body.data.id}`)).send({})).status === 200);

  // Phase 3 settings
  const put = await H(agent.put('/api/settings')).send({ company_name: 'Audit Co', address_line1: '1', city: 'J', state: 'MO', zip: '64801', phone: '4175550100', email: 'X@Y.COM' });
  check('settings put', put.status === 200);
  const get = await agent.get('/api/settings');
  check('phone normalized', get.body.data.phone === '(417) 555-0100', `got ${get.body.data.phone}`);
  check('email lowercased', get.body.data.email === 'x@y.com', `got ${get.body.data.email}`);
  check('settings markups put', (await H(agent.put('/api/settings/markups')).send([{ category: 'materials', percent: 0.15 }])).status === 200);
  check('placeholders endpoint', (await agent.get('/api/settings/placeholders')).status === 200);

  // Phase 6 customer + markup clear
  const cust = (await H(agent.post('/api/customers')).send({ name: `Aud ${s}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
  await H(agent.put(`/api/customers/${cust.id}/markups`)).send([{ category: 'materials', percent: 0.3 }]);
  const clr = await H(agent.del(`/api/customers/${cust.id}/markups/materials`)).send({});
  check('customer markup clear (use default)', clr.status === 200 && clr.body.data.materials === undefined);
  check('customers CSV export', (await agent.get('/api/customers/export/csv')).status === 200);

  // Phase 8 jobs CSV + delete guard
  const job = (await H(agent.post('/api/jobs')).send({ code: `D26AUD${s}`, customer_id: cust.id, description: 'audit' })).body.data;
  check('jobs CSV export', (await agent.get('/api/jobs/export/csv')).status === 200);
  // delete customer w/ job -> 409
  check('customer delete blocked by job (409)', (await H(agent.del(`/api/customers/${cust.id}`)).send({})).status === 409);

  // Phase 5 employee CSV + dup name
  const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
  const emp = (await H(agent.post('/api/employees')).send({ name: `Aud Emp ${s}`, level_id: lvl.id })).body.data;
  check('employee create', !!emp?.id);
  check('employee dup name rejected', (await H(agent.post('/api/employees')).send({ name: `Aud Emp ${s}`, level_id: lvl.id })).status >= 400);
  check('employees CSV export', (await agent.get('/api/employees/export/csv')).status === 200);

  // Phase 9 copy-week + locked
  await H(agent.post('/api/time/entries')).send({ employee_id: emp.id, job_id: job.id, work_date: '2024-06-03', st_hours: 8, ot_hours: 0, dt_hours: 0 });
  const copy = await H(agent.post('/api/time/copy-week?from=2024-06-03&to=2024-06-10')).send({});
  check('copy-week', copy.status === 200 && copy.body.data.copied >= 1, JSON.stringify(copy.body));
  // future-date guard on expense
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const futExp = await H(agent.post('/api/expenses')).send({ work_date: future, job_id: job.id, vendor: 'V', amount: 10, category: 'materials' });
  check('expense future-date >30d rejected', futExp.status === 400, `got ${futExp.status} (Phase 10 validation)`);

  // Phase 10 expense + attachment preview
  const exp = (await H(agent.post('/api/expenses')).send({ work_date: '2024-06-03', job_id: job.id, vendor: 'V', amount: 10, category: 'materials' })).body.data;
  // upload a real, valid pdf (pdf-lib) so the gs+gm thumbnail can render it
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const pg = doc.addPage([300, 200]);
  pg.drawText('Receipt', { x: 40, y: 120, font: await doc.embedFont(StandardFonts.Helvetica), size: 24 });
  const pdfBuf = Buffer.from(await doc.save());
  const att = await H(agent.post(`/api/expenses/${exp.id}/attachments`)).attach('file', pdfBuf, 'r.pdf');
  check('pdf attachment upload', att.status === 201, `got ${att.status}`);
  if (att.status === 201) {
    const prev = await agent.get(`/api/expenses/attachments/${att.body.data.id}/preview`);
    check('attachment preview thumbnail endpoint', prev.status === 200, `got ${prev.status} (Phase 10 task 16)`);
  }

  // Phase 14 example template download
  check('example-template download endpoint', (await agent.get('/api/settings/example-template')).status === 200, '(Phase 14)');

  // Phase 17 smtp test-connect
  check('smtp test-connect endpoint', [200, 400, 422, 503].includes((await H(agent.post('/api/settings/smtp/test')).send({ to: 'x@y.com' })).status), '(Phase 17)');

  // Phase: bill processing inbox
  const ib = await H(agent.post('/api/inbox')).attach('files', pdfBuf, 'bill.pdf');
  check('inbox upload (pdf -> ready)', ib.status === 201 && ib.body.data.created[0]?.status === 'ready', `got ${ib.status}`);
  const docId = ib.body?.data?.created?.[0]?.id;
  if (docId) {
    const list = await agent.get('/api/inbox');
    check('inbox list contains the doc', list.body.data.some((d: any) => d.id === docId));
    check('inbox preview thumbnail', (await agent.get(`/api/inbox/${docId}/preview`)).status === 200);
    check('inbox download', (await agent.get(`/api/inbox/${docId}/download`)).status === 200);
    const proc = await H(agent.post(`/api/inbox/${docId}/process`)).send({ work_date: '2024-06-03', job_id: job.id, vendor: 'Inbox Vendor', amount: 77.5, category: 'materials' });
    check('inbox process -> expense', proc.status === 201 && !!proc.body.data.expense?.id, `got ${proc.status}`);
    const expId = proc.body?.data?.expense?.id;
    if (expId) {
      const expDetail = await agent.get(`/api/expenses/${expId}`);
      check('processed expense has a ready attachment', expDetail.body.data.attachments?.[0]?.status === 'ready');
    }
    check('inbox doc removed after processing (download 404)', (await agent.get(`/api/inbox/${docId}/download`)).status === 404);
  }

  // Public (no-login) upload page — token gated
  const TOKEN = process.env.PUBLIC_UPLOAD_TOKEN ?? '';
  const pubNoToken = await H(request(app).post('/api/public/upload')).attach('files', pdfBuf, 'pub.pdf');
  check('public upload without token rejected (401)', pubNoToken.status === 401, `got ${pubNoToken.status}`);
  check('public token check (valid)', (await request(app).get(`/api/public/upload/check?k=${TOKEN}`)).status === 200);
  check('public token check (invalid 401)', (await request(app).get('/api/public/upload/check?k=wrong')).status === 401);
  const pub = await H(request(app).post(`/api/public/upload?k=${encodeURIComponent(TOKEN)}`)).field('job_code', 'D26AUDPUB').field('notes', 'left at front desk').attach('files', pdfBuf, 'pub.pdf');
  check('public upload with token (201, no login)', pub.status === 201 && pub.body.data.created === 1, `got ${pub.status}`);
  // it lands in the inbox with the job code + notes + source=public (admin view)
  const inboxList = (await agent.get('/api/inbox')).body.data;
  const pubDoc = inboxList.find((d: any) => d.submitted_job_code === 'D26AUDPUB');
  check('public bill appears in inbox with job code + notes', !!pubDoc && pubDoc.notes === 'left at front desk' && pubDoc.source === 'public');

  console.log(`\nAUDIT: ${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:\n' + fails.map((f) => '  - ' + f).join('\n'));
  await sql.end();
  // Exit non-zero when any check failed so CI / operators don't read a failed
  // audit run as success.
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('AUDIT CRASH', e); process.exit(1); });
