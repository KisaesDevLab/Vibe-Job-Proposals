import { z } from 'zod';
import { Router } from 'express';
import { ok, fail, timeEntrySchema, timeEntryBulkSchema } from '@darrow/shared';
import { db, sql as rawsql, timeEntries } from '@darrow/db';
import { eq, and, isNull } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';

export const timeRouter = Router();

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// GET /api/time/week?week_start=YYYY-MM-DD -> nested employee>job>days
timeRouter.get(
  '/week',
  ah(async (req, res) => {
    const weekStart = (req.query.week_start as string) ?? new Date().toISOString().slice(0, 10);
    const weekEnd = addDays(weekStart, 6);
    const employeeId = (req.query.employee_id as string) || null;
    const rows = await rawsql<any[]>`
      SELECT te.id, te.employee_id, e.name AS employee_name, te.job_id, j.code AS job_code,
             te.work_date::text AS work_date, te.st_hours, te.ot_hours, te.dt_hours, te.invoice_id,
             inv.billed_reference
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      JOIN jobs j ON j.id = te.job_id
      LEFT JOIN invoices inv ON inv.id = te.invoice_id
      WHERE te.work_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
        AND (${employeeId}::uuid IS NULL OR te.employee_id = ${employeeId}::uuid)
      ORDER BY e.name, j.code, te.work_date`;
    const byEmp = new Map<string, any>();
    for (const r of rows) {
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, { employee_id: r.employee_id, employee_name: r.employee_name, jobs: new Map() });
      const emp = byEmp.get(r.employee_id);
      if (!emp.jobs.has(r.job_id)) emp.jobs.set(r.job_id, { job_id: r.job_id, job_code: r.job_code, days: [] });
      emp.jobs.get(r.job_id).days.push({
        id: r.id,
        date: r.work_date,
        st: Number(r.st_hours),
        ot: Number(r.ot_hours),
        dt: Number(r.dt_hours),
        invoice_id: r.invoice_id,
        billed_reference: r.billed_reference,
      });
    }
    const data = [...byEmp.values()].map((e) => ({ ...e, jobs: [...e.jobs.values()] }));
    res.json(ok({ week_start: weekStart, week_end: weekEnd, employees: data }));
  }),
);

// upsert a single entry; if all zero -> delete
async function upsertOne(tx: any, e: { employee_id: string; job_id: string; work_date: string; st_hours: number; ot_hours: number; dt_hours: number }) {
  const allZero = e.st_hours <= 0 && e.ot_hours <= 0 && e.dt_hours <= 0;
  // refuse to touch locked (invoiced) rows
  const existing = await tx`SELECT id, invoice_id FROM time_entries WHERE employee_id=${e.employee_id} AND job_id=${e.job_id} AND work_date=${e.work_date}::date LIMIT 1`;
  if (existing.length && existing[0].invoice_id) {
    throw new HttpError(409, 'locked', 'Entry is billed and locked');
  }
  if (allZero) {
    if (existing.length) await tx`DELETE FROM time_entries WHERE id=${existing[0].id}`;
    return { deleted: true };
  }
  const rows = await tx`
    INSERT INTO time_entries (employee_id, job_id, work_date, st_hours, ot_hours, dt_hours)
    VALUES (${e.employee_id}, ${e.job_id}, ${e.work_date}::date, ${e.st_hours}, ${e.ot_hours}, ${e.dt_hours})
    ON CONFLICT (employee_id, job_id, work_date)
    DO UPDATE SET st_hours=EXCLUDED.st_hours, ot_hours=EXCLUDED.ot_hours, dt_hours=EXCLUDED.dt_hours, updated_at=now()
    RETURNING *`;
  return rows[0];
}

timeRouter.post(
  '/entries',
  ah(async (req, res) => {
    const e = timeEntrySchema.parse(req.body);
    const result = await rawsql.begin((tx: any) => upsertOne(tx, e as any));
    res.json(ok(result));
  }),
);

// Single-cell merge: set ONE tier on the (employee, job, date) row, reading the
// other two tiers from the DB inside the transaction so concurrent edits to
// sibling tiers can't clobber each other (lost-update fix).
const cellSchema = z.object({
  employee_id: z.string().uuid(),
  job_id: z.string().uuid(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tier: z.enum(['st', 'ot', 'dt']),
  hours: z.coerce.number().min(0).max(24),
});
timeRouter.post(
  '/cell',
  ah(async (req, res) => {
    const c = cellSchema.parse(req.body);
    const result = await rawsql.begin(async (tx: any) => {
      const existing = await tx`SELECT id, invoice_id, st_hours, ot_hours, dt_hours FROM time_entries
        WHERE employee_id=${c.employee_id} AND job_id=${c.job_id} AND work_date=${c.work_date}::date FOR UPDATE`;
      if (existing.length && existing[0].invoice_id) throw new HttpError(409, 'locked', 'Entry is billed and locked');
      const cur = existing[0] ?? { st_hours: 0, ot_hours: 0, dt_hours: 0 };
      const merged = {
        employee_id: c.employee_id,
        job_id: c.job_id,
        work_date: c.work_date,
        st_hours: Number(cur.st_hours) || 0,
        ot_hours: Number(cur.ot_hours) || 0,
        dt_hours: Number(cur.dt_hours) || 0,
      };
      merged[`${c.tier}_hours` as 'st_hours'] = c.hours;
      return upsertOne(tx, merged);
    });
    res.json(ok(result));
  }),
);

timeRouter.post(
  '/entries/bulk',
  ah(async (req, res) => {
    const entries = timeEntryBulkSchema.parse(req.body);
    const result = await rawsql.begin(async (tx: any) => {
      const out = [];
      for (const e of entries) out.push(await upsertOne(tx, e as any));
      return out;
    });
    res.json(ok(result));
  }),
);

timeRouter.delete(
  '/entries/:id',
  ah(async (req, res) => {
    const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, req.params.id));
    if (!row) throw new HttpError(404, 'not_found', 'Entry not found');
    if (row.invoiceId) return res.status(409).json(fail('locked', 'Entry is billed and locked'));
    await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));
    res.json(ok({ deleted: true }));
  }),
);

// copy all unbilled rows from one week to another
timeRouter.post(
  '/copy-week',
  ah(async (req, res) => {
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!from || !to) throw new HttpError(400, 'bad_request', 'from and to required');
    const offset = Math.round((new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000);
    const src = await db
      .select()
      .from(timeEntries)
      .where(and(isNull(timeEntries.invoiceId)));
    const fromEnd = addDays(from, 6);
    const inWeek = src.filter((r) => r.workDate >= from && r.workDate <= fromEnd);
    const result = await rawsql.begin(async (tx: any) => {
      const out = [];
      for (const r of inWeek) {
        out.push(
          await upsertOne(tx, {
            employee_id: r.employeeId,
            job_id: r.jobId,
            work_date: addDays(r.workDate, offset),
            st_hours: Number(r.stHours),
            ot_hours: Number(r.otHours),
            dt_hours: Number(r.dtHours),
          }),
        );
      }
      return out;
    });
    res.json(ok({ copied: result.length }));
  }),
);
