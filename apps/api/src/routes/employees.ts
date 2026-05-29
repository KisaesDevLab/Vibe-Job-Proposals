import { Router } from 'express';
import { ok, fail, employeeSchema, costRateSchema } from '@darrow/shared';
import { db, sql as rawsql, employees, employeeCostRates, rateLevels, timeEntries } from '@darrow/db';
import { eq, and, isNull, desc, asc, sql } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const employeesRouter = Router();

// current cost rate = the open-ended (effective_to null) or covering-today row
async function currentRate(employeeId: string) {
  const rows = await db
    .select()
    .from(employeeCostRates)
    .where(eq(employeeCostRates.employeeId, employeeId))
    .orderBy(desc(employeeCostRates.effectiveFrom));
  const today = new Date().toISOString().slice(0, 10);
  return (
    rows.find((r) => r.effectiveFrom <= today && (r.effectiveTo == null || r.effectiveTo > today)) ??
    rows[0] ??
    null
  );
}

employeesRouter.get(
  '/',
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await db
      .select({
        id: employees.id,
        name: employees.name,
        levelId: employees.levelId,
        levelName: rateLevels.name,
        active: employees.active,
        hireDate: employees.hireDate,
        notes: employees.notes,
      })
      .from(employees)
      .leftJoin(rateLevels, eq(employees.levelId, rateLevels.id))
      .orderBy(asc(employees.name));
    const data = [];
    for (const r of rows) {
      if (!includeInactive && !r.active) continue;
      const cr = await currentRate(r.id);
      data.push({ ...r, current_rate: cr });
    }
    res.json(ok(data));
  }),
);

employeesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [emp] = await db.select().from(employees).where(eq(employees.id, req.params.id));
    if (!emp) throw new HttpError(404, 'not_found', 'Employee not found');
    const history = await db
      .select()
      .from(employeeCostRates)
      .where(eq(employeeCostRates.employeeId, emp.id))
      .orderBy(desc(employeeCostRates.effectiveFrom));
    res.json(ok({ ...emp, cost_rate_history: history, current_rate: await currentRate(emp.id) }));
  }),
);

employeesRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = employeeSchema.parse(req.body);
    const [lvl] = await db.select().from(rateLevels).where(eq(rateLevels.id, body.level_id));
    if (!lvl || !lvl.active) return res.status(400).json(fail('bad_level', 'Rate level not found or inactive'));
    const [row] = await db
      .insert(employees)
      .values({ name: body.name, levelId: body.level_id, active: body.active ?? true, hireDate: body.hire_date ?? null, notes: body.notes ?? null })
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'employee', entityId: row.id, action: 'create', summary: `Created employee ${row.name}` });
    res.status(201).json(ok(row));
  }),
);

employeesRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = employeeSchema.partial().parse(req.body);
    if (body.active === false) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(timeEntries)
        .where(and(eq(timeEntries.employeeId, req.params.id), isNull(timeEntries.invoiceId)));
      if (n > 0) return res.status(409).json(fail('has_unbilled', `Employee has ${n} unbilled time entries`, { count: n }));
    }
    const [row] = await db
      .update(employees)
      .set({ name: body.name, levelId: body.level_id, active: body.active, hireDate: body.hire_date, notes: body.notes })
      .where(eq(employees.id, req.params.id))
      .returning();
    if (!row) throw new HttpError(404, 'not_found', 'Employee not found');
    await writeAudit({ userId: req.user?.id, entityType: 'employee', entityId: row.id, action: body.active === false ? 'deactivate' : 'update', summary: `Updated employee ${row.name}` });
    res.json(ok(row));
  }),
);

employeesRouter.post(
  '/:id/cost-rates',
  ah(async (req: AuthedRequest, res) => {
    const body = costRateSchema.parse(req.body);
    const empId = req.params.id;
    const result = await db.transaction(async (tx) => {
      // close prior open rate
      const dayBefore = new Date(body.effective_from);
      dayBefore.setUTCDate(dayBefore.getUTCDate());
      await tx
        .update(employeeCostRates)
        .set({ effectiveTo: body.effective_from })
        .where(and(eq(employeeCostRates.employeeId, empId), isNull(employeeCostRates.effectiveTo)));
      const [row] = await tx
        .insert(employeeCostRates)
        .values({
          employeeId: empId,
          effectiveFrom: body.effective_from,
          costSt: String(body.cost_st),
          costOt: String(body.cost_ot),
          costDt: String(body.cost_dt),
        })
        .returning();
      return row;
    });
    await writeAudit({ userId: req.user?.id, entityType: 'employee', entityId: empId, action: 'update', summary: `Added cost rate effective ${body.effective_from}` });
    res.status(201).json(ok(result));
  }),
);

employeesRouter.get(
  '/export/csv',
  ah(async (_req, res) => {
    const rows = await rawsql`
      SELECT e.name, l.name AS level, cr.cost_st, cr.cost_ot, cr.cost_dt, e.active
      FROM employees e JOIN rate_levels l ON l.id = e.level_id
      LEFT JOIN LATERAL (
        SELECT cost_st, cost_ot, cost_dt FROM employee_cost_rates
        WHERE employee_id = e.id AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1
      ) cr ON true ORDER BY e.name`;
    const header = 'name,level,cost_st,cost_ot,cost_dt,active\n';
    const csv = header + rows.map((r: any) => `"${r.name}","${r.level}",${r.cost_st ?? 0},${r.cost_ot ?? 0},${r.cost_dt ?? 0},${r.active}`).join('\n');
    res.type('text/csv').attachment('employees.csv').send(csv);
  }),
);
