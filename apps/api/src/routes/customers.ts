import { Router } from 'express';
import { ok, fail, customerSchema, markupMapSchema } from '@darrow/shared';
import { db, customers, customerMarkupDefaults, jobs } from '@darrow/db';
import { eq, and, asc, sql } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const customersRouter = Router();

async function markupMap(customerId: string) {
  const rows = await db.select().from(customerMarkupDefaults).where(eq(customerMarkupDefaults.customerId, customerId));
  return Object.fromEntries(rows.map((r) => [r.category, Number(r.percent)]));
}

function csvEscape(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

// CSV export (must precede '/:id'). Phase 6 task 21.
customersRouter.get(
  '/export/csv',
  ah(async (_req, res) => {
    const rows = await db.select().from(customers).orderBy(asc(customers.name));
    const header = 'name,address1,city,state,zip,contact_name,contact_email,contact_phone,active\n';
    const csv =
      header +
      rows
        .map((c) =>
          [c.name, c.billToAddress1, c.billToCity, c.billToState, c.billToZip, c.contactName, c.contactEmail, c.contactPhone, c.active]
            .map(csvEscape)
            .join(','),
        )
        .join('\n');
    res.type('text/csv').attachment('customers.csv').send(csv);
  }),
);

customersRouter.get(
  '/',
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await db.select().from(customers).orderBy(asc(customers.name));
    const counts = await db
      .select({ customerId: jobs.customerId, n: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.customerId);
    const cmap = new Map(counts.map((c) => [c.customerId, c.n]));
    const data = [];
    for (const r of rows) {
      if (!includeInactive && !r.active) continue;
      data.push({ ...r, markups: await markupMap(r.id), job_count: cmap.get(r.id) ?? 0 });
    }
    res.json(ok(data));
  }),
);

customersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [row] = await db.select().from(customers).where(eq(customers.id, req.params.id));
    if (!row) throw new HttpError(404, 'not_found', 'Customer not found');
    res.json(ok({ ...row, markups: await markupMap(row.id) }));
  }),
);

customersRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = customerSchema.parse(req.body);
    const [row] = await db
      .insert(customers)
      .values({
        name: body.name,
        billToAddress1: body.bill_to_address1,
        billToAddress2: body.bill_to_address2,
        billToCity: body.bill_to_city,
        billToState: body.bill_to_state,
        billToZip: body.bill_to_zip,
        contactName: body.contact_name,
        contactEmail: body.contact_email.toLowerCase(),
        contactPhone: body.contact_phone,
        active: body.active ?? true,
        notes: body.notes ?? null,
      })
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'customer', entityId: row.id, action: 'create', summary: `Created customer ${row.name}` });
    res.status(201).json(ok(row));
  }),
);

customersRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = customerSchema.partial().parse(req.body);
    const [row] = await db
      .update(customers)
      .set({
        name: body.name,
        billToAddress1: body.bill_to_address1,
        billToAddress2: body.bill_to_address2,
        billToCity: body.bill_to_city,
        billToState: body.bill_to_state,
        billToZip: body.bill_to_zip,
        contactName: body.contact_name,
        contactEmail: body.contact_email?.toLowerCase(),
        contactPhone: body.contact_phone,
        active: body.active,
        notes: body.notes,
      })
      .where(eq(customers.id, req.params.id))
      .returning();
    if (!row) throw new HttpError(404, 'not_found', 'Customer not found');
    await writeAudit({ userId: req.user?.id, entityType: 'customer', entityId: row.id, action: 'update', summary: `Updated customer ${row.name}` });
    res.json(ok(row));
  }),
);

customersRouter.put(
  '/:id/markups',
  ah(async (req: AuthedRequest, res) => {
    const body = markupMapSchema.parse(req.body);
    await db.transaction(async (tx) => {
      for (const m of body) {
        await tx
          .insert(customerMarkupDefaults)
          .values({ customerId: req.params.id, category: m.category, percent: String(m.percent) })
          .onConflictDoUpdate({
            target: [customerMarkupDefaults.customerId, customerMarkupDefaults.category],
            set: { percent: String(m.percent) },
          });
      }
    });
    res.json(ok(await markupMap(req.params.id)));
  }),
);

// clear a single override (use default)
customersRouter.delete(
  '/:id/markups/:category',
  ah(async (req, res) => {
    await db
      .delete(customerMarkupDefaults)
      .where(
        and(
          eq(customerMarkupDefaults.customerId, req.params.id),
          eq(customerMarkupDefaults.category, req.params.category as any),
        ),
      );
    res.json(ok(await markupMap(req.params.id)));
  }),
);

customersRouter.delete(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.customerId, req.params.id));
    if (n > 0) return res.status(409).json(fail('has_jobs', `Customer has ${n} jobs; deactivate instead`, { count: n }));
    await db.delete(customers).where(eq(customers.id, req.params.id));
    res.json(ok({ deleted: true }));
  }),
);
