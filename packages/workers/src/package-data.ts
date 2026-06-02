// Data shape for the multi-page invoice package PDF.
// Pulls the snapshot via invoice-data.ts plus the bound time_entries / expenses
// (which are locked once the invoice is finalized) to drive pages 2-4.
import { sql } from '@darrow/db';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@darrow/shared';
import { buildInvoiceData } from './invoice-data.js';

export type EmployeeHoursRow = {
  employeeName: string;
  st: number;
  ot: number;
  dt: number;
};

export type DailyGridRow = {
  jobCode: string;
  billedRef: string;
  workDate: string; // YYYY-MM-DD
  employeeName: string;
  st: number;
  ot: number;
  dt: number;
  laborAmount: number;
  dow: number; // 0=Mon..6=Sun
};

export type ExpenseLogRow = {
  expenseId: string;
  workDate: string; // YYYY-MM-DD
  vendor: string;
  reference: string;
  description: string;
  category: string; // raw enum
  amount: number;
  sortKey: string; // canonical key — also used to order attachments
};

export type AttachmentRef = {
  expenseId: string;
  expenseWorkDate: string;
  expenseVendor: string;
  attachmentId: string;
  storedPath: string;
  status: string;
  originalFilename: string;
};

export type OverheadRow = {
  employeeName: string;
  hours: number;
  amount: number;
};

export type PackageData = {
  invoiceData: Record<string, any>;
  invoiceId: string;
  billedReference: string;
  jobCode: string;
  employeeHours: EmployeeHoursRow[];
  dailyGrid: DailyGridRow[];
  expenseLog: ExpenseLogRow[];
  overhead: OverheadRow | null;
  attachments: AttachmentRef[];
};

// Mon=0..Sun=6 (Excel/legacy convention matches our Time grid).
function dowMonFirst(yyyymmdd: string): number {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  return (d.getUTCDay() + 6) % 7;
}

export async function buildPackageData(invoiceId: string): Promise<PackageData> {
  const invoiceData = await buildInvoiceData(invoiceId);
  const [inv] = await sql<any[]>`
    SELECT i.id, i.billed_reference, i.total_overhead, j.code AS job_code
    FROM invoices i JOIN jobs j ON j.id=i.job_id
    WHERE i.id=${invoiceId}`;
  if (!inv) throw new Error(`invoice ${invoiceId} not found`);

  // Overhead snapshot — the line is persisted with line_type='overhead' so we
  // can pull its employee + hours straight from invoice_line_items.
  const [ohRow] = await sql<any[]>`
    SELECT li.quantity, li.amount, e.name AS employee_name
    FROM invoice_line_items li
    JOIN employees e ON e.id = li.employee_id
    WHERE li.invoice_id = ${invoiceId} AND li.line_type = 'overhead'
    LIMIT 1`;
  const overhead: OverheadRow | null = ohRow
    ? { employeeName: ohRow.employee_name, hours: Number(ohRow.quantity), amount: Number(ohRow.amount) }
    : null;

  // Source time-entry rows from the *snapshot* (invoice_line_items.time_entry_id)
  // so the package stays consistent after void (which clears time_entries.invoice_id
  // but leaves the snapshot intact). For pre-0020 finalized invoices where the
  // snapshot lacks time_entry_id, fall back to the live binding so historical
  // packages still render.
  const snapshotTe = await sql<any[]>`
    SELECT DISTINCT te.id, te.work_date::text AS work_date, te.employee_id,
                    e.name AS employee_name, te.st_hours, te.ot_hours, te.dt_hours
    FROM invoice_line_items li
    JOIN time_entries te ON te.id = li.time_entry_id
    JOIN employees e ON e.id = te.employee_id
    WHERE li.invoice_id = ${invoiceId} AND li.line_type = 'labor' AND li.time_entry_id IS NOT NULL
    ORDER BY work_date, employee_name`;
  // Note: ORDER BY must reference SELECT-list expressions when DISTINCT is
  // in use. te.work_date (date) isn't in the SELECT list — only the aliased
  // te.work_date::text AS work_date is — so order by the alias instead.
  const teRows = snapshotTe.length > 0 ? snapshotTe : await sql<any[]>`
    SELECT te.id, te.work_date::text AS work_date, te.employee_id, e.name AS employee_name,
           te.st_hours, te.ot_hours, te.dt_hours
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    WHERE te.invoice_id = ${invoiceId}
    ORDER BY te.work_date, e.name`;

  // Per-row labor $ source. Prefer the snapshot's per-time-entry amount
  // (which is correct even when a mid-invoice promotion makes a single
  // (employee, tier) carry different unit_rates across dates). Pre-0020
  // snapshots have NULL time_entry_id; fall back to the (employee, tier)
  // rate map for those.
  const amountRows = await sql<any[]>`
    SELECT time_entry_id, amount
    FROM invoice_line_items
    WHERE invoice_id = ${invoiceId} AND line_type = 'labor' AND time_entry_id IS NOT NULL`;
  const amountByTeId = new Map<string, number>();
  for (const r of amountRows) amountByTeId.set(r.time_entry_id, (amountByTeId.get(r.time_entry_id) ?? 0) + Number(r.amount));

  const rateRows = await sql<any[]>`
    SELECT employee_id, tier, unit_rate
    FROM invoice_line_items
    WHERE invoice_id = ${invoiceId} AND line_type = 'labor' AND employee_id IS NOT NULL AND time_entry_id IS NULL`;
  const rateMap = new Map<string, number>();
  for (const r of rateRows) rateMap.set(`${r.employee_id}|${r.tier}`, Number(r.unit_rate));
  const rateOf = (empId: string, tier: 'st' | 'ot' | 'dt') => rateMap.get(`${empId}|${tier}`) ?? 0;

  // Employee hour totals across all dates on this invoice.
  const empMap = new Map<string, EmployeeHoursRow>();
  for (const r of teRows) {
    const cur = empMap.get(r.employee_name) ?? { employeeName: r.employee_name, st: 0, ot: 0, dt: 0 };
    cur.st += Number(r.st_hours);
    cur.ot += Number(r.ot_hours);
    cur.dt += Number(r.dt_hours);
    empMap.set(r.employee_name, cur);
  }
  const employeeHours = [...empMap.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  // Daily grid rows — one per (date, employee). The legacy Excel groups by job
  // code, but the snapshot is already scoped to one job/billing ref, so we
  // present the rows under the same job header.
  const billedRef = inv.billed_reference ?? inv.job_code;
  const dailyGrid: DailyGridRow[] = teRows.map((r) => {
    const st = Number(r.st_hours);
    const ot = Number(r.ot_hours);
    const dt = Number(r.dt_hours);
    // Prefer the snapshot's sum-of-amounts for this time_entry (correct
    // per-day even after a level promotion); fall back to hours × map rate.
    const snapAmount = amountByTeId.get(r.id);
    const laborAmount = snapAmount != null
      ? snapAmount
      : st * rateOf(r.employee_id, 'st') + ot * rateOf(r.employee_id, 'ot') + dt * rateOf(r.employee_id, 'dt');
    return {
      jobCode: inv.job_code,
      billedRef,
      workDate: r.work_date,
      employeeName: r.employee_name,
      st, ot, dt,
      laborAmount,
      dow: dowMonFirst(r.work_date),
    };
  });

  // Expense log — bound expenses, ordered canonically by category → vendor →
  // work_date → reference. The same sort key drives the attachment order at
  // the back of the package, so receipts appear in the same sequence as their
  // entries on the expense log page.
  //
  // Source from the *snapshot* (invoice_line_items.expense_id) so the package
  // stays consistent after the invoice is voided (which clears
  // expenses.invoice_id). Fall back to live binding for pre-snapshot drafts.
  const snapshotExp = await sql<any[]>`
    SELECT DISTINCT e.id, e.work_date::text AS work_date, e.vendor, e.reference,
                    e.amount, e.category, e.description
    FROM invoice_line_items li
    JOIN expenses e ON e.id = li.expense_id
    WHERE li.invoice_id = ${invoiceId} AND li.line_type = 'expense' AND li.expense_id IS NOT NULL`;
  const expRows = snapshotExp.length > 0 ? snapshotExp : await sql<any[]>`
    SELECT id, work_date::text AS work_date, vendor, reference, amount, category, description
    FROM expenses
    WHERE invoice_id = ${invoiceId}`;

  const catRank = (c: string): number => {
    const i = (EXPENSE_CATEGORIES as readonly string[]).indexOf(c);
    return i < 0 ? 999 : i;
  };
  const sortKey = (e: { category: string; vendor: string | null; work_date: string; reference: string | null; id: string }) =>
    `${String(catRank(e.category)).padStart(3, '0')}|${(e.vendor ?? '').toLowerCase()}|${e.work_date}|${(e.reference ?? '').toLowerCase()}|${e.id}`;

  const expenseLog: ExpenseLogRow[] = expRows
    .map((e) => ({
      expenseId: e.id,
      workDate: e.work_date,
      vendor: e.vendor ?? '',
      reference: e.reference ?? '',
      description: e.description ?? '',
      category: e.category ?? 'materials',
      amount: Number(e.amount),
      sortKey: sortKey(e),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // Attachments for the back of the package — only ones that finished
  // converting — and ordered by the parent expense's sort key, with
  // attachments inside one expense by created_at.
  const orderByExpenseId = new Map(expenseLog.map((r, i) => [r.expenseId, i]));
  let attachments: AttachmentRef[] = [];
  if (expRows.length) {
    const atts = await sql<any[]>`
      SELECT ea.id AS attachment_id, ea.expense_id, ea.stored_path, ea.status, ea.original_filename, ea.created_at,
             e.work_date::text AS work_date, e.vendor
      FROM expense_attachments ea
      JOIN expenses e ON e.id = ea.expense_id
      WHERE ea.expense_id IN ${sql(expRows.map((e) => e.id))} AND ea.status = 'ready'`;
    attachments = atts
      .map((a) => ({
        expenseId: a.expense_id,
        expenseWorkDate: a.work_date,
        expenseVendor: a.vendor ?? '',
        attachmentId: a.attachment_id,
        storedPath: a.stored_path,
        status: a.status,
        originalFilename: a.original_filename,
        _expenseOrder: orderByExpenseId.get(a.expense_id) ?? 9999,
        _createdAt: a.created_at,
      }))
      .sort((a, b) => a._expenseOrder - b._expenseOrder || (a._createdAt < b._createdAt ? -1 : 1))
      .map(({ _expenseOrder, _createdAt, ...rest }) => { void _expenseOrder; void _createdAt; return rest; });
  }

  return {
    invoiceData,
    invoiceId,
    billedReference: billedRef,
    jobCode: inv.job_code,
    employeeHours,
    dailyGrid,
    expenseLog,
    overhead,
    attachments,
  };
}

// Re-export the type that was previously named "materials" so any external
// consumer doesn't break — but the rendered shape is now expenseLog.
export type ExpenseCategoryEnum = ExpenseCategory;
