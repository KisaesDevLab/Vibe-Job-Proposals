// API integration tests (Phases 2/5/7/9/12/13/16) using supertest against the
// real app + Postgres + Redis. Gated on DATABASE_URL so the unit-only green gate
// (no DB) still passes; these run in CI where DATABASE_URL is set.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const H = (a: request.Test) => a.set('X-Requested-With', 'darrow');

d('API integration', () => {
  let app: any;
  let agent: ReturnType<typeof request.agent>;
  let sql: any;
  const suffix = Date.now().toString().slice(-7);
  const ids: any = {};

  beforeAll(async () => {
    const { runMigrations } = await import('@darrow/db');
    await runMigrations();
    ({ sql } = await import('@darrow/db'));
    const { createApp } = await import('./app.js');
    app = createApp();
    agent = request.agent(app);

    // ensure a known test admin exists
    const hash = await bcrypt.hash('integration-test-pw-123456', 12);
    await sql`INSERT INTO users (username, password_hash, role) VALUES ('itest', ${hash}, 'admin')
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash`;
  });

  // ---- Phase 2: auth ----
  it('rejects protected routes without a session (401)', async () => {
    const res = await H(request(app).get('/api/employees'));
    expect(res.status).toBe(401);
  });

  it('rejects mutating requests without the CSRF header (403)', async () => {
    const res = await request(app).post('/api/customers').send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  it('logs in and returns the current user', async () => {
    const login = await H(agent.post('/api/auth/login')).send({ username: 'itest', password: 'integration-test-pw-123456' });
    expect(login.status).toBe(200);
    expect(login.body.data.username).toBe('itest');
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.username).toBe('itest');
  });

  // ---- Phase 5: cost-rate exclusion constraint ----
  it('rejects overlapping employee cost rates at the DB layer', async () => {
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    const emp = (await H(agent.post('/api/employees')).send({ name: `Exc ${suffix}`, level_id: lvl.id })).body.data;
    const r1 = await H(agent.post(`/api/employees/${emp.id}/cost-rates`)).send({ effective_from: '2024-01-01', cost_st: 40, cost_ot: 60, cost_dt: 80 });
    expect(r1.status).toBe(201);
    // direct overlapping insert must be rejected by the gist exclusion constraint
    await expect(
      sql`INSERT INTO employee_cost_rates (employee_id, effective_from, effective_to, cost_st, cost_ot, cost_dt)
          VALUES (${emp.id}, '2023-06-01', '2024-06-01', 1, 1, 1)`,
    ).rejects.toThrow();
  });

  // ---- Phases 7/9/11/12/13/16: full lifecycle ----
  it('drafts, finalizes (snapshot == preview), enforces one draft, voids and reissues', async () => {
    const cust = (await H(agent.post('/api/customers')).send({ name: `Itest Co ${suffix}`, bill_to_address1: '1 A', bill_to_city: 'Joplin', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Foreman'`;
    const sched = (await H(agent.post(`/api/customers/${cust.id}/rate-schedules`)).send({ name: 'S', effective_from: '2024-01-01' })).body.data;
    await H(agent.post(`/api/rate-schedules/${sched.id}/lines/bulk`)).send([{ level_id: lvl.id, rate_1x: 100, rate_15x: 150, rate_2x: 200 }]);
    const emp = (await H(agent.post('/api/employees')).send({ name: `Itest Tech ${suffix}`, level_id: lvl.id })).body.data;
    await H(agent.post(`/api/employees/${emp.id}/cost-rates`)).send({ effective_from: '2024-01-01', cost_st: 40, cost_ot: 60, cost_dt: 80 });
    const job = (await H(agent.post('/api/jobs')).send({ code: `D26IT${suffix}`, customer_id: cust.id, description: 'Itest' })).body.data;
    await H(agent.post('/api/time/entries')).send({ employee_id: emp.id, job_id: job.id, work_date: '2024-02-05', st_hours: 8, ot_hours: 2, dt_hours: 0 });
    await H(agent.post('/api/expenses')).send({ work_date: '2024-02-05', job_id: job.id, vendor: 'V', amount: 200, category: 'materials' });
    ids.job = job.id;

    const draft = (await H(agent.post('/api/invoices/draft')).send({ job_id: job.id, through_date: '2024-12-31' })).body.data;
    // one-draft-per-job
    const dup = await H(agent.post('/api/invoices/draft')).send({ job_id: job.id, through_date: '2024-12-31' });
    expect(dup.status).toBe(409);

    const detail = (await agent.get(`/api/invoices/${draft.id}`)).body.data;
    const preview = detail.preview;
    expect(preview.blockers).toHaveLength(0);
    // 8*100 + 2*150 = 1100 labor; 200 materials @15% = 30 markup; grand 1330
    expect(preview.totals.total_labor).toBe(1100);
    expect(preview.totals.total_markup).toBe(30);
    expect(preview.totals.grand_total).toBe(1330);

    const fin = (await H(agent.post(`/api/invoices/${draft.id}/finalize`)).send({})).body.data;
    expect(fin.billed_reference).toBe(`D26IT${suffix}.01`);

    // snapshot header totals == preview, and == sum of value lines
    const after = (await agent.get(`/api/invoices/${draft.id}`)).body.data;
    expect(Number(after.invoice.grand_total)).toBe(1330);
    const valueSum = after.line_items
      .filter((l: any) => ['labor', 'expense', 'expense_markup'].includes(l.lineType))
      .reduce((a: number, l: any) => a + Number(l.amount), 0);
    expect(valueSum).toBeCloseTo(1330, 2);

    // markup overrides blocked after finalize
    const blocked = await H(agent.put(`/api/invoices/${draft.id}/markup-overrides`)).send([{ category: 'materials', percent: 0.2 }]);
    expect(blocked.status).toBe(409);

    // void unbinds entries and keeps the sequence number
    const v = await H(agent.post(`/api/invoices/${draft.id}/void`)).send({ reason: 'test' });
    expect(v.status).toBe(200);
    const [te] = await sql`SELECT invoice_id FROM time_entries WHERE job_id=${job.id} LIMIT 1`;
    expect(te.invoice_id).toBeNull();

    // reissue -> sequence 2 (voided number not reused)
    const draft2 = (await H(agent.post('/api/invoices/draft')).send({ job_id: job.id, through_date: '2024-12-31' })).body.data;
    const fin2 = (await H(agent.post(`/api/invoices/${draft2.id}/finalize`)).send({})).body.data;
    expect(fin2.sequence_number).toBe(2);
    expect(fin2.billed_reference).toBe(`D26IT${suffix}.02`);
  });

  // ---- Phase 9: time upsert deletes on all-zero ----
  it('deletes a time entry when all hours go to zero', async () => {
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    const emp = (await H(agent.post('/api/employees')).send({ name: `Zero ${suffix}`, level_id: lvl.id })).body.data;
    const cust = (await H(agent.post('/api/customers')).send({ name: `ZeroCo ${suffix}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    const job = (await H(agent.post('/api/jobs')).send({ code: `D26Z${suffix}`, customer_id: cust.id, description: 'z' })).body.data;
    await H(agent.post('/api/time/entries')).send({ employee_id: emp.id, job_id: job.id, work_date: '2024-03-01', st_hours: 5, ot_hours: 0, dt_hours: 0 });
    let rows = await sql`SELECT id FROM time_entries WHERE employee_id=${emp.id} AND job_id=${job.id}`;
    expect(rows.length).toBe(1);
    await H(agent.post('/api/time/entries')).send({ employee_id: emp.id, job_id: job.id, work_date: '2024-03-01', st_hours: 0, ot_hours: 0, dt_hours: 0 });
    rows = await sql`SELECT id FROM time_entries WHERE employee_id=${emp.id} AND job_id=${job.id}`;
    expect(rows.length).toBe(0);
  });

  // ---- Phase 11: markup precedence over HTTP (customer override) ----
  it('applies customer markup override in invoice preview', async () => {
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Foreman'`;
    const cust = (await H(agent.post('/api/customers')).send({ name: `MkCo ${suffix}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    await H(agent.put(`/api/customers/${cust.id}/markups`)).send([{ category: 'materials', percent: 0.25 }]);
    const sched = (await H(agent.post(`/api/customers/${cust.id}/rate-schedules`)).send({ name: 'S', effective_from: '2024-01-01' })).body.data;
    await H(agent.post(`/api/rate-schedules/${sched.id}/lines/bulk`)).send([{ level_id: lvl.id, rate_1x: 100, rate_15x: 150, rate_2x: 200 }]);
    const job = (await H(agent.post('/api/jobs')).send({ code: `D26MK${suffix}`, customer_id: cust.id, description: 'mk' })).body.data;
    await H(agent.post('/api/expenses')).send({ work_date: '2024-04-01', job_id: job.id, vendor: 'V', amount: 400, category: 'materials' });
    const draft = (await H(agent.post('/api/invoices/draft')).send({ job_id: job.id, through_date: '2024-12-31' })).body.data;
    const detail = (await agent.get(`/api/invoices/${draft.id}`)).body.data;
    // 400 * 25% = 100 markup, source = customer
    expect(detail.preview.totals.total_markup).toBe(100);
    expect(detail.preview.expense_lines[0].markup_source).toBe('customer');
  });

  // ---- Phase 4: FK-guarded delete ----
  it('blocks deleting a rate level that is referenced by an employee (409)', async () => {
    const lvl = (await H(agent.post('/api/rate-levels')).send({ name: `Ref ${suffix}` })).body.data;
    await H(agent.post('/api/employees')).send({ name: `RefEmp ${suffix}`, level_id: lvl.id });
    const del = await H(agent.del(`/api/rate-levels/${lvl.id}`)).send({});
    expect(del.status).toBe(409);
    expect(del.body.error.details.count).toBeGreaterThan(0);
  });

  // ---- Phases 5/7: half-open [from,to) interval semantics ----
  it('getRateAt / getCostRateAt honor half-open intervals at the boundary', async () => {
    const { getRateAt, getCostRateAt } = await import('./services/lookup.js');
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    const cust = (await H(agent.post('/api/customers')).send({ name: `Bnd ${suffix}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    // closed schedule window [2024-01-01, 2024-07-01)
    const sched = (await H(agent.post(`/api/customers/${cust.id}/rate-schedules`)).send({ name: 'W', effective_from: '2024-01-01', effective_to: '2024-07-01' })).body.data;
    await H(agent.post(`/api/rate-schedules/${sched.id}/lines/bulk`)).send([{ level_id: lvl.id, rate_1x: 50, rate_15x: 75, rate_2x: 100 }]);

    const inside = await getRateAt(cust.id, lvl.id, '2024-06-30');
    expect('rate_1x' in inside && inside.rate_1x).toBe(50);
    const onFrom = await getRateAt(cust.id, lvl.id, '2024-01-01'); // inclusive
    expect('rate_1x' in onFrom).toBe(true);
    const onTo = await getRateAt(cust.id, lvl.id, '2024-07-01'); // exclusive -> no schedule
    expect('error' in onTo && onTo.error).toBe('no_schedule');

    const emp = (await H(agent.post('/api/employees')).send({ name: `Bnd Emp ${suffix}`, level_id: lvl.id })).body.data;
    await H(agent.post(`/api/employees/${emp.id}/cost-rates`)).send({ effective_from: '2024-01-01', cost_st: 30, cost_ot: 45, cost_dt: 60 });
    const costBefore = await getCostRateAt(emp.id, '2023-12-31');
    expect('error' in costBefore && costBefore.error).toBe('no_cost_rate');
    const costOn = await getCostRateAt(emp.id, '2024-01-01');
    expect('cost_st' in costOn && costOn.cost_st).toBe(30);
  });

  // ---- Phase 5: adding a new cost rate auto-closes the prior open one ----
  it('auto-closes the prior open cost rate when adding a new one', async () => {
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    const emp = (await H(agent.post('/api/employees')).send({ name: `AC ${suffix}`, level_id: lvl.id })).body.data;
    await H(agent.post(`/api/employees/${emp.id}/cost-rates`)).send({ effective_from: '2024-01-01', cost_st: 30, cost_ot: 45, cost_dt: 60 });
    await H(agent.post(`/api/employees/${emp.id}/cost-rates`)).send({ effective_from: '2024-06-01', cost_st: 35, cost_ot: 52, cost_dt: 70 });
    const rows = await sql`SELECT effective_from::text f, effective_to::text t FROM employee_cost_rates WHERE employee_id=${emp.id} ORDER BY effective_from`;
    expect(rows.length).toBe(2);
    expect(rows[0].t).toBe('2024-06-01'); // prior closed at the new from
    expect(rows[1].t).toBeNull(); // new one open-ended
  });

  // ---- Per-user SMTP settings (Phase 17 extension) ----
  it('stores per-user SMTP settings and never returns the password', async () => {
    const put = await H(agent.put('/api/auth/smtp')).send({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'itest@example.com',
      smtp_password: 'super-secret',
      smtp_from_address: 'itest@example.com',
      smtp_from_name: 'Integration Tester',
      smtp_enabled: true,
    });
    expect(put.status).toBe(200);
    const get = await agent.get('/api/auth/smtp');
    expect(get.body.data.smtp_host).toBe('smtp.example.com');
    expect(get.body.data.smtp_from_address).toBe('itest@example.com');
    expect(get.body.data.smtp_password_set).toBe(true);
    // password (encrypted or plain) must never be exposed
    expect(JSON.stringify(get.body.data)).not.toContain('super-secret');
    expect('smtp_password' in get.body.data).toBe(false);
    expect('smtp_password_enc' in get.body.data).toBe(false);
    // and the encrypted value is actually stored
    const [u] = await sql`SELECT smtp_password_enc, smtp_enabled FROM users WHERE username='itest'`;
    expect(u.smtp_enabled).toBe(true);
    expect(u.smtp_password_enc).toMatch(/.+:.+:.+/);
  });

  // ---- Phase 9 extension: per-employee week filter ----
  it('filters the weekly time view by employee', async () => {
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    const cust = (await H(agent.post('/api/customers')).send({ name: `EW ${suffix}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    const job = (await H(agent.post('/api/jobs')).send({ code: `D26EW${suffix}`, customer_id: cust.id, description: 'ew' })).body.data;
    const e1 = (await H(agent.post('/api/employees')).send({ name: `EW One ${suffix}`, level_id: lvl.id })).body.data;
    const e2 = (await H(agent.post('/api/employees')).send({ name: `EW Two ${suffix}`, level_id: lvl.id })).body.data;
    await H(agent.post('/api/time/entries')).send({ employee_id: e1.id, job_id: job.id, work_date: '2024-07-01', st_hours: 8, ot_hours: 0, dt_hours: 0 });
    await H(agent.post('/api/time/entries')).send({ employee_id: e2.id, job_id: job.id, work_date: '2024-07-01', st_hours: 5, ot_hours: 0, dt_hours: 0 });

    const all = (await agent.get('/api/time/week?week_start=2024-07-01')).body.data.employees;
    expect(all.filter((x: any) => x.employee_id === e1.id || x.employee_id === e2.id).length).toBe(2);

    const onlyE1 = (await agent.get(`/api/time/week?week_start=2024-07-01&employee_id=${e1.id}`)).body.data.employees;
    expect(onlyE1).toHaveLength(1);
    expect(onlyE1[0].employee_id).toBe(e1.id);
    expect(onlyE1[0].jobs[0].job_code).toBe(`D26EW${suffix}`);
  });

  // ---- Bill processing inbox ----
  it('uploads a bill to the inbox and processes it into an expense', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const pdfBuf = Buffer.from(await pdf.save());

    const up = await H(agent.post('/api/inbox')).attach('files', pdfBuf, 'bill.pdf');
    expect(up.status).toBe(201);
    expect(up.body.data.created[0].status).toBe('ready');
    const docId = up.body.data.created[0].id;

    const list = (await agent.get('/api/inbox')).body.data;
    expect(list.some((d: any) => d.id === docId)).toBe(true);
    expect((await agent.get(`/api/inbox/${docId}/download`)).status).toBe(200);

    // need a job to attach the expense to
    const [lvl] = await sql`SELECT id FROM rate_levels WHERE name='Journeyman'`;
    void lvl;
    const cust = (await H(agent.post('/api/customers')).send({ name: `Inbox Co ${suffix}`, bill_to_address1: '1', bill_to_city: 'J', bill_to_state: 'MO', bill_to_zip: '64801' })).body.data;
    const job = (await H(agent.post('/api/jobs')).send({ code: `D26IB${suffix}`, customer_id: cust.id, description: 'inbox' })).body.data;

    const proc = await H(agent.post(`/api/inbox/${docId}/process`)).send({ work_date: '2024-06-03', job_id: job.id, vendor: 'Acme Supply', amount: 123.45, category: 'materials' });
    expect(proc.status).toBe(201);
    const expId = proc.body.data.expense.id;

    // expense exists with a ready attachment, inbox row gone
    const exp = (await agent.get(`/api/expenses/${expId}`)).body.data;
    expect(exp.vendor).toBe('Acme Supply');
    expect(exp.attachments).toHaveLength(1);
    expect(exp.attachments[0].status).toBe('ready');
    expect((await agent.get(`/api/inbox/${docId}/download`)).status).toBe(404);
    const after = (await agent.get('/api/inbox')).body.data;
    expect(after.some((d: any) => d.id === docId)).toBe(false);
  });

  it('blocks processing a pending document and supports discard', async () => {
    // a row with status pending (no real file) cannot be processed
    const [doc] = await sql`INSERT INTO inbox_documents (original_filename, stored_path, content_type, file_size_bytes, status)
      VALUES ('x.jpg', '/nope/x.jpg', 'image/jpeg', 10, 'pending') RETURNING id`;
    const blocked = await H(agent.post(`/api/inbox/${doc.id}/process`)).send({ work_date: '2024-06-03', job_id: '00000000-0000-0000-0000-000000000000', vendor: 'v', amount: 1, category: 'materials' });
    expect(blocked.status).toBe(409);
    const del = await H(agent.del(`/api/inbox/${doc.id}`)).send({});
    expect(del.status).toBe(200);
  });

  it('logs out and clears the session', async () => {
    await H(agent.post('/api/auth/logout')).send({});
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});
