import { Router } from 'express';
import { ok } from '@darrow/shared';
import { sql as rawsql } from '@darrow/db';
import { ah, HttpError } from '../error-handler.js';

export const reportsRouter = Router();

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function respond(res: any, rows: any[], format: string, name: string) {
  if (format === 'csv') return res.type('text/csv').attachment(`${name}.csv`).send(toCsv(rows));
  // pdf is best-effort: return CSV-equivalent text wrapped as a simple response note
  if (format === 'pdf') return res.type('text/plain').attachment(`${name}.txt`).send(toCsv(rows));
  return res.json(ok(rows));
}

// Job totals over a date range — each job with hours, priced labor, and expenses
// in [from, to], plus what's still unbillable, as the launch pad for invoicing.
reportsRouter.get(
  '/job-totals',
  ah(async (req, res) => {
    const { from, to, customer_id, format = 'json' } = req.query as Record<string, string>;
    if (!from || !to) throw new HttpError(400, 'bad_request', 'from and to dates required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new HttpError(400, 'bad_request', 'dates must be YYYY-MM-DD');
    }
    const rows = await rawsql<any[]>`
      WITH labor AS (
        SELECT te.job_id,
          SUM(te.st_hours)::numeric(12,2) AS st_hours,
          SUM(te.ot_hours)::numeric(12,2) AS ot_hours,
          SUM(te.dt_hours)::numeric(12,2) AS dt_hours,
          SUM(te.st_hours*COALESCE(rsl.rate_1x,0) + te.ot_hours*COALESCE(rsl.rate_15x,0) + te.dt_hours*COALESCE(rsl.rate_2x,0))::numeric(12,2) AS labor_amount,
          bool_or(rsl.id IS NULL AND (te.st_hours>0 OR te.ot_hours>0 OR te.dt_hours>0)) AS missing_rate,
          COUNT(*) FILTER (WHERE te.invoice_id IS NULL) AS unbilled_time
        FROM time_entries te
        JOIN jobs j ON j.id = te.job_id
        JOIN employees e ON e.id = te.employee_id
        LEFT JOIN rate_schedules rs ON rs.customer_id = j.customer_id
          AND daterange(rs.effective_from, rs.effective_to, '[)') @> te.work_date
        LEFT JOIN rate_schedule_lines rsl ON rsl.schedule_id = rs.id AND rsl.level_id = e.level_id
        WHERE te.work_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY te.job_id
      ),
      exp AS (
        SELECT x.job_id,
          SUM(x.amount)::numeric(12,2) AS expense_amount,
          COUNT(*) FILTER (WHERE x.invoice_id IS NULL) AS unbilled_expense
        FROM expenses x
        WHERE x.work_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY x.job_id
      )
      SELECT j.id AS job_id, j.code, c.name AS customer_name, j.billing_type,
        COALESCE(labor.st_hours,0) AS st_hours,
        COALESCE(labor.ot_hours,0) AS ot_hours,
        COALESCE(labor.dt_hours,0) AS dt_hours,
        (COALESCE(labor.st_hours,0)+COALESCE(labor.ot_hours,0)+COALESCE(labor.dt_hours,0)) AS total_hours,
        COALESCE(labor.labor_amount,0) AS labor_amount,
        COALESCE(exp.expense_amount,0) AS expense_amount,
        (COALESCE(labor.labor_amount,0)+COALESCE(exp.expense_amount,0)) AS total_amount,
        COALESCE(labor.missing_rate,false) AS missing_rate,
        (COALESCE(labor.unbilled_time,0)+COALESCE(exp.unbilled_expense,0)) AS unbilled_count,
        (SELECT id FROM invoices WHERE job_id=j.id AND status='draft' LIMIT 1) AS open_draft_id
      FROM jobs j
      JOIN customers c ON c.id = j.customer_id
      LEFT JOIN labor ON labor.job_id = j.id
      LEFT JOIN exp ON exp.job_id = j.id
      WHERE (labor.job_id IS NOT NULL OR exp.job_id IS NOT NULL)
        AND (${customer_id ?? null}::uuid IS NULL OR j.customer_id = ${customer_id ?? null}::uuid)
      ORDER BY total_amount DESC, c.name, j.code`;
    if (format === 'csv') {
      const flat = rows.map((r) => ({ code: r.code, customer: r.customer_name, billing_type: r.billing_type, st_hours: r.st_hours, ot_hours: r.ot_hours, dt_hours: r.dt_hours, total_hours: r.total_hours, labor_amount: r.labor_amount, expense_amount: r.expense_amount, total_amount: r.total_amount, unbilled_count: r.unbilled_count }));
      return respond(res, flat, 'csv', 'job-totals');
    }
    res.json(ok(rows));
  }),
);

// Report 1 — Hours by Employee for Job/Invoice
reportsRouter.get(
  '/employee-hours',
  ah(async (req, res) => {
    const { job_id, invoice_id, format = 'json' } = req.query as Record<string, string>;
    if (!job_id) throw new HttpError(400, 'bad_request', 'job_id required');
    const rows = await rawsql<any[]>`
      SELECT e.name AS employee,
        SUM(te.st_hours)::numeric(10,2) AS st,
        SUM(te.ot_hours)::numeric(10,2) AS ot,
        SUM(te.dt_hours)::numeric(10,2) AS dt,
        SUM(te.st_hours+te.ot_hours+te.dt_hours)::numeric(10,2) AS total
      FROM time_entries te JOIN employees e ON e.id=te.employee_id
      WHERE te.job_id=${job_id}
        AND (${invoice_id ?? null}::uuid IS NULL OR te.invoice_id=${invoice_id ?? null}::uuid)
      GROUP BY e.name ORDER BY e.name`;
    respond(res, rows, format, 'employee-hours');
  }),
);

// Report 2 — Time Detail
reportsRouter.get(
  '/time-detail',
  ah(async (req, res) => {
    const { job_id, invoice_id, from, to, format = 'json' } = req.query as Record<string, string>;
    if (!job_id) throw new HttpError(400, 'bad_request', 'job_id required');
    const rows = await rawsql<any[]>`
      SELECT te.work_date::text AS date, e.name AS employee, te.st_hours AS st, te.ot_hours AS ot, te.dt_hours AS dt,
             i.billed_reference AS invoice
      FROM time_entries te JOIN employees e ON e.id=te.employee_id
      LEFT JOIN invoices i ON i.id=te.invoice_id
      WHERE te.job_id=${job_id}
        AND (${invoice_id ?? null}::uuid IS NULL OR te.invoice_id=${invoice_id ?? null}::uuid)
        AND (${from ?? null}::date IS NULL OR te.work_date >= ${from ?? null}::date)
        AND (${to ?? null}::date IS NULL OR te.work_date <= ${to ?? null}::date)
      ORDER BY te.work_date, e.name`;
    respond(res, rows, format, 'time-detail');
  }),
);

// Report 3 — Expense List
reportsRouter.get(
  '/expense-list',
  ah(async (req, res) => {
    const { job_id, invoice_id, format = 'json' } = req.query as Record<string, string>;
    if (!job_id) throw new HttpError(400, 'bad_request', 'job_id required');
    const rows = await rawsql<any[]>`
      SELECT x.work_date::text AS date, x.vendor, x.category, x.description, x.amount,
        (SELECT count(*)::int FROM expense_attachments a WHERE a.expense_id=x.id) AS attachments,
        i.billed_reference AS invoice
      FROM expenses x LEFT JOIN invoices i ON i.id=x.invoice_id
      WHERE x.job_id=${job_id}
        AND (${invoice_id ?? null}::uuid IS NULL OR x.invoice_id=${invoice_id ?? null}::uuid)
      ORDER BY x.category, x.work_date`;
    respond(res, rows, format, 'expense-list');
  }),
);

// Readiness dashboard
reportsRouter.get(
  '/readiness',
  ah(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const jobsNoSchedule = await rawsql<any[]>`
      SELECT j.id, j.code, c.name AS customer FROM jobs j JOIN customers c ON c.id=j.customer_id
      WHERE j.active = true AND NOT EXISTS (
        SELECT 1 FROM rate_schedules rs WHERE rs.customer_id=j.customer_id
          AND daterange(rs.effective_from, rs.effective_to, '[)') @> ${today}::date)`;
    const empNoCost = await rawsql<any[]>`
      SELECT e.id, e.name FROM employees e WHERE e.active = true AND NOT EXISTS (
        SELECT 1 FROM employee_cost_rates cr WHERE cr.employee_id=e.id
          AND daterange(cr.effective_from, cr.effective_to, '[)') @> ${today}::date
          AND (cr.cost_st > 0 OR cr.cost_ot > 0 OR cr.cost_dt > 0))`;
    const failedAtt = await rawsql<any[]>`
      SELECT a.id, a.original_filename, e.id AS expense_id FROM expense_attachments a
      JOIN expenses e ON e.id=a.expense_id WHERE a.status='failed'`;
    const oldDrafts = await rawsql<any[]>`
      SELECT i.id, j.code AS job_code, i.created_at FROM invoices i JOIN jobs j ON j.id=i.job_id
      WHERE i.status='draft' AND i.created_at < now() - interval '30 days'`;
    res.json(
      ok({
        jobs_without_schedule: { count: jobsNoSchedule.length, items: jobsNoSchedule },
        employees_without_cost: { count: empNoCost.length, items: empNoCost },
        failed_attachments: { count: failedAtt.length, items: failedAtt },
        stale_drafts: { count: oldDrafts.length, items: oldDrafts },
      }),
    );
  }),
);
