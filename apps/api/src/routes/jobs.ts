import { Router } from 'express';
import { ok, fail, jobSchema } from '@darrow/shared';
import { db, jobs, customers, timeEntries, expenses, invoices } from '@darrow/db';
import { eq, and, ilike, or, sql, desc } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const jobsRouter = Router();

jobsRouter.get(
  '/',
  ah(async (req, res) => {
    const { customer_id, active, billing_type, search } = req.query as Record<string, string>;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const pageSize = Math.min(200, parseInt((req.query.pageSize as string) ?? '50', 10));
    const conds = [];
    if (customer_id) conds.push(eq(jobs.customerId, customer_id));
    if (active === 'true') conds.push(eq(jobs.active, true));
    if (active === 'false') conds.push(eq(jobs.active, false));
    if (billing_type) conds.push(eq(jobs.billingType, billing_type as any));
    if (search) conds.push(or(ilike(jobs.code, `%${search}%`), ilike(jobs.description, `%${search}%`)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select({
        id: jobs.id,
        code: jobs.code,
        customerId: jobs.customerId,
        customerName: customers.name,
        description: jobs.description,
        poNumber: jobs.poNumber,
        billingType: jobs.billingType,
        active: jobs.active,
        invoiceCount: sql<number>`(SELECT count(*)::int FROM invoices WHERE job_id = ${jobs.id} AND status != 'void')`,
      })
      .from(jobs)
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs).where(where);
    res.json(ok({ jobs: rows, page, pageSize, total: count }));
  }),
);

// CSV export (must precede '/:id'). Phase 8 task 19.
jobsRouter.get(
  '/export/csv',
  ah(async (_req, res) => {
    const rows = await db
      .select({ code: jobs.code, customer: customers.name, description: jobs.description, billingType: jobs.billingType, active: jobs.active })
      .from(jobs)
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .orderBy(desc(jobs.createdAt));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'code,customer,description,billing_type,active\n';
    const csv = header + rows.map((r) => [r.code, r.customer, r.description, r.billingType, r.active].map(esc).join(',')).join('\n');
    res.type('text/csv').attachment('jobs.csv').send(csv);
  }),
);

jobsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, req.params.id));
    if (!job) throw new HttpError(404, 'not_found', 'Job not found');
    const [cust] = await db.select().from(customers).where(eq(customers.id, job.customerId));
    res.json(ok({ ...job, customer: cust ?? null }));
  }),
);

jobsRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = jobSchema.parse(req.body);
    const [cust] = await db.select().from(customers).where(eq(customers.id, body.customer_id));
    if (!cust) return res.status(400).json(fail('bad_customer', 'Customer not found'));
    if (!cust.active) return res.status(400).json(fail('inactive_customer', 'Customer is inactive'));
    const dup = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.code, body.code));
    if (dup.length) return res.status(409).json(fail('dup_code', 'Job code already exists (case-insensitive)'));
    const [row] = await db
      .insert(jobs)
      .values({
        code: body.code,
        customerId: body.customer_id,
        description: body.description,
        poNumber: body.po_number ?? null,
        billingType: body.billing_type,
        siteAddress1: body.site_address1,
        siteAddress2: body.site_address2,
        siteCity: body.site_city,
        siteState: body.site_state,
        siteZip: body.site_zip,
        active: body.active ?? true,
        notes: body.notes ?? null,
      })
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'job', entityId: row.id, action: 'create', summary: `Created job ${row.code}` });
    res.status(201).json(ok(row));
  }),
);

jobsRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = jobSchema.partial().parse(req.body);
    const [row] = await db
      .update(jobs)
      .set({
        code: body.code,
        customerId: body.customer_id,
        description: body.description,
        poNumber: body.po_number,
        billingType: body.billing_type,
        siteAddress1: body.site_address1,
        siteAddress2: body.site_address2,
        siteCity: body.site_city,
        siteState: body.site_state,
        siteZip: body.site_zip,
        active: body.active,
        notes: body.notes,
      })
      .where(eq(jobs.id, req.params.id))
      .returning();
    if (!row) throw new HttpError(404, 'not_found', 'Job not found');
    await writeAudit({ userId: req.user?.id, entityType: 'job', entityId: row.id, action: 'update', summary: `Updated job ${row.code}` });
    res.json(ok(row));
  }),
);

jobsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const [{ t }] = await db.select({ t: sql<number>`count(*)::int` }).from(timeEntries).where(eq(timeEntries.jobId, req.params.id));
    const [{ e }] = await db.select({ e: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.jobId, req.params.id));
    const [{ i }] = await db.select({ i: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.jobId, req.params.id));
    if (t + e + i > 0) return res.status(409).json(fail('in_use', 'Job has time/expenses/invoices; deactivate instead', { time: t, expenses: e, invoices: i }));
    await db.delete(jobs).where(eq(jobs.id, req.params.id));
    res.json(ok({ deleted: true }));
  }),
);
