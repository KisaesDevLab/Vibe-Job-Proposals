// Generic .xlsx import framework. Admin uploads a workbook + picks a "type";
// we parse the first non-empty sheet (or a named one), match headers to the
// type's expected columns, validate per-row, and return a preview the admin
// can review before committing.
//
// Two phases:
//   1. preview(buffer, type) -> { rows, errors }
//   2. commit(rows, type, userId) -> { inserted, updated, skipped }
//
// Initial types: 'expenses', 'customers'. The framework adds new types via the
// IMPORTERS map below.

import ExcelJS from 'exceljs';
import { sql } from '@darrow/db';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@darrow/shared';
import { writeAudit } from '../audit.js';

export type ImportType = 'expenses' | 'customers' | 'jobs' | 'time-entries';

export interface PreviewError { row: number; field?: string; message: string; }
export interface PreviewResult<TRow = any> {
  type: ImportType;
  sheet_name: string;
  total_rows: number;
  rows: Array<TRow & { _row: number; _errors?: string[] }>;
  errors: PreviewError[];
}

export interface CommitResult { inserted: number; updated: number; skipped: number; }

// ─── Helpers ───────────────────────────────────────────────────────────────

type Cell = string | number | Date | boolean | null;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('text' in v && typeof (v as any).text === 'string') return (v as any).text;
    if ('richText' in v && Array.isArray((v as any).richText)) return (v as any).richText.map((t: any) => t.text).join('');
    // Formula cell: prefer the cached `result`. Workbooks written by tools
    // that don't cache results (some Mac/web exporters) leave `result`
    // undefined — returning `String(v)` then yields "[object Object]" which
    // silently corrupts dates/numbers. Treat absent result as null so the
    // row's validator flags it instead of inventing data.
    if ('result' in v) {
      const r = (v as any).result;
      if (r === undefined) return null;
      return cellValue(r);
    }
  }
  return String(v);
}

function toStr(v: Cell): string { return v == null ? '' : String(v).trim(); }
function toNum(v: Cell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function toDateStr(v: Cell): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear(); const m = String(v.getUTCMonth() + 1).padStart(2, '0'); const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let yy = Number(m[3]); if (yy < 100) yy += 2000;
    return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear(); const mo = String(d.getUTCMonth() + 1).padStart(2, '0'); const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

interface SheetRead {
  sheetName: string;
  headers: string[];   // normalized
  rawHeaders: string[]; // original
  rows: Array<Record<string, Cell>>; // keyed by normalized header
}

async function readFirstNonEmptySheet(buffer: Buffer): Promise<SheetRead> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheets = wb.worksheets;
  if (sheets.length === 0) throw new Error('Workbook has no sheets');

  for (const sheet of sheets) {
    // Find the first row that looks like headers (non-empty string cells)
    let headerRowNum = -1;
    sheet.eachRow({ includeEmpty: false }, (row, num) => {
      if (headerRowNum > 0) return;
      const vals: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cellValue(cell.value)));
      const nonEmpty = vals.filter((v) => v != null && String(v).trim() !== '').length;
      if (nonEmpty >= 2) headerRowNum = num;
    });
    if (headerRowNum < 0) continue;

    const headerRow = sheet.getRow(headerRowNum);
    const rawHeaders: string[] = [];
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const text = toStr(cellValue(cell.value));
      rawHeaders[col - 1] = text;
      headers[col - 1] = normalizeHeader(text);
    });
    if (headers.length === 0) continue;

    const rows: Array<Record<string, Cell>> = [];
    sheet.eachRow({ includeEmpty: false }, (row, num) => {
      if (num <= headerRowNum) return;
      const r: Record<string, Cell> = { _row: num };
      let any = false;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const key = headers[col - 1];
        if (!key) return;
        const v = cellValue(cell.value);
        if (v != null && String(v).trim() !== '') any = true;
        r[key] = v;
      });
      if (any) rows.push(r);
    });
    return { sheetName: sheet.name, headers, rawHeaders, rows };
  }
  throw new Error('No non-empty sheet found in workbook');
}

// ─── Importer: Expenses ────────────────────────────────────────────────────

interface ExpenseRow {
  work_date: string;
  vendor: string;
  reference: string | null;
  category: ExpenseCategory;
  amount: number;
  description: string | null;
  job_code: string;
}

async function previewExpenses(buffer: Buffer): Promise<PreviewResult<ExpenseRow>> {
  const sheet = await readFirstNonEmptySheet(buffer);
  const rows: Array<ExpenseRow & { _row: number; _errors?: string[] }> = [];
  const errors: PreviewError[] = [];

  // Build a job_code → id map up front so per-row validation is cheap.
  const jobs = await sql<{ id: string; code: string }[]>`SELECT id, code FROM jobs`;
  const jobByCode = new Map(jobs.map((j) => [j.code.toLowerCase(), j.id]));

  for (const r of sheet.rows) {
    const rowNum = r._row as number;
    const work_date = toDateStr(r.date ?? r.work_date ?? r.workdate);
    const vendor = toStr(r.vendor);
    const reference = toStr(r.reference ?? r.ref ?? r.invoice_number) || null;
    const categoryRaw = toStr(r.category ?? r.account).toLowerCase();
    const job_code = toStr(r.job ?? r.job_code ?? r.jobcode);
    const amount = toNum(r.amount ?? r.total);
    const description = toStr(r.description ?? r.memo ?? r.notes) || null;

    const rowErrors: string[] = [];
    if (!work_date) rowErrors.push('Date missing or unparseable');
    if (!vendor) rowErrors.push('Vendor required');
    if (!job_code) rowErrors.push('Job code required');
    else if (!jobByCode.has(job_code.toLowerCase())) rowErrors.push(`Job code "${job_code}" not found`);
    let category: ExpenseCategory | null = null;
    if (!categoryRaw) rowErrors.push('Category required');
    else {
      // Accept either an enum value ("materials") or its display label
      // ("Materials & Parts"). Normalize both sides to alpha-only lowercase
      // so spaces, ampersands, and underscores don't trip the match.
      const norm = categoryRaw.replace(/[^a-z]/g, '');
      const match = (EXPENSE_CATEGORIES as readonly string[]).find((c) => {
        if (c.replace(/_/g, '') === norm) return true;
        const label = EXPENSE_CATEGORY_LABELS[c as ExpenseCategory].toLowerCase().replace(/[^a-z]/g, '');
        return label === norm;
      });
      if (match) category = match as ExpenseCategory;
      else rowErrors.push(`Unknown category "${categoryRaw}"`);
    }
    if (amount == null) rowErrors.push('Amount required');
    else if (amount === 0) rowErrors.push('Amount must be non-zero');

    rows.push({
      _row: rowNum,
      work_date: work_date ?? '',
      vendor,
      reference,
      category: category ?? ('materials' as ExpenseCategory),
      // Accounting exports (AW, QuickBooks, etc.) record expenses as negative
      // amounts ("money out"). The expenses table stores positive magnitudes
      // and has a CHECK (amount > 0) constraint, so absolute-value on import.
      // Refunds/credits aren't currently a domain concept; if they become one
      // we'd add a sign column rather than allow negatives here.
      amount: amount != null ? Math.abs(amount) : 0,
      description,
      job_code,
      _errors: rowErrors.length ? rowErrors : undefined,
    });
    for (const m of rowErrors) errors.push({ row: rowNum, message: m });
  }
  return { type: 'expenses', sheet_name: sheet.sheetName, total_rows: rows.length, rows, errors };
}

async function commitExpenses(rows: Array<ExpenseRow & { _row: number }>, userId: string | null): Promise<CommitResult> {
  const jobs = await sql<{ id: string; code: string }[]>`SELECT id, code FROM jobs`;
  const jobByCode = new Map(jobs.map((j) => [j.code.toLowerCase(), j.id]));
  // Wrap the whole batch in a transaction so a failure mid-stream rolls
  // back the partial insert — the operator re-runs after fixing the bad
  // row instead of being left with N-of-M committed.
  const counts = await sql.begin(async (tx: any) => {
    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const jobId = jobByCode.get(r.job_code.toLowerCase());
      if (!jobId || !r.work_date || !r.vendor || !r.amount) { skipped++; continue; }
      await tx`INSERT INTO expenses (work_date, job_id, vendor, reference, amount, category, description)
        VALUES (${r.work_date}::date, ${jobId}, ${r.vendor}, ${r.reference}, ${r.amount}, ${r.category}, ${r.description})`;
      inserted++;
    }
    return { inserted, skipped };
  });
  if (counts.inserted > 0) {
    await writeAudit({ userId, entityType: 'expense', entityId: 'bulk', action: 'import', summary: `Imported ${counts.inserted} expense(s) from xlsx; ${counts.skipped} skipped` });
  }
  return { inserted: counts.inserted, updated: 0, skipped: counts.skipped };
}

// ─── Importer: Customers ───────────────────────────────────────────────────

interface CustomerRow {
  name: string;
  bill_to_address1: string;
  bill_to_address2: string;
  bill_to_city: string;
  bill_to_state: string;
  bill_to_zip: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
}

async function previewCustomers(buffer: Buffer): Promise<PreviewResult<CustomerRow>> {
  const sheet = await readFirstNonEmptySheet(buffer);
  const rows: Array<CustomerRow & { _row: number; _errors?: string[] }> = [];
  const errors: PreviewError[] = [];
  for (const r of sheet.rows) {
    const rowNum = r._row as number;
    const name = toStr(r.name ?? r.customer ?? r.customer_name);
    const rowErrors: string[] = [];
    if (!name) rowErrors.push('Name required');
    rows.push({
      _row: rowNum,
      name,
      bill_to_address1: toStr(r.address ?? r.address1 ?? r.bill_to_address1 ?? r.street),
      bill_to_address2: toStr(r.address2 ?? r.address_line_2 ?? r.bill_to_address2),
      bill_to_city: toStr(r.city ?? r.bill_to_city),
      bill_to_state: toStr(r.state ?? r.bill_to_state),
      bill_to_zip: toStr(r.zip ?? r.zipcode ?? r.postal_code ?? r.bill_to_zip),
      contact_name: toStr(r.contact ?? r.contact_name),
      contact_email: toStr(r.email ?? r.contact_email).toLowerCase(),
      contact_phone: toStr(r.phone ?? r.contact_phone),
      _errors: rowErrors.length ? rowErrors : undefined,
    });
    for (const m of rowErrors) errors.push({ row: rowNum, message: m });
  }
  return { type: 'customers', sheet_name: sheet.sheetName, total_rows: rows.length, rows, errors };
}

async function commitCustomers(rows: Array<CustomerRow & { _row: number }>, userId: string | null): Promise<CommitResult> {
  // Coerce every text field to a string up front so the UPDATE's parameter
  // binding never sees `undefined` (postgres.js rejects undefined).
  const s = (v: unknown): string => v == null ? '' : String(v);
  const counts = await sql.begin(async (tx: any) => {
    let inserted = 0; let updated = 0; let skipped = 0;
    for (const raw of rows) {
      const r = {
        name: s(raw.name),
        bill_to_address1: s(raw.bill_to_address1),
        bill_to_address2: s(raw.bill_to_address2),
        bill_to_city: s(raw.bill_to_city),
        bill_to_state: s(raw.bill_to_state),
        bill_to_zip: s(raw.bill_to_zip),
        contact_name: s(raw.contact_name),
        contact_email: s(raw.contact_email),
        contact_phone: s(raw.contact_phone),
      };
      if (!r.name) { skipped++; continue; }
      // Case-insensitive name match; insert if new, otherwise overlay only the
      // non-empty fields supplied (don't blank existing values).
      const [existing] = await tx`SELECT id FROM customers WHERE lower(name) = lower(${r.name}) LIMIT 1` as { id: string }[];
      if (existing) {
        await tx`UPDATE customers SET
          bill_to_address1 = CASE WHEN ${r.bill_to_address1} = '' THEN bill_to_address1 ELSE ${r.bill_to_address1} END,
          bill_to_address2 = CASE WHEN ${r.bill_to_address2} = '' THEN bill_to_address2 ELSE ${r.bill_to_address2} END,
          bill_to_city = CASE WHEN ${r.bill_to_city} = '' THEN bill_to_city ELSE ${r.bill_to_city} END,
          bill_to_state = CASE WHEN ${r.bill_to_state} = '' THEN bill_to_state ELSE ${r.bill_to_state} END,
          bill_to_zip = CASE WHEN ${r.bill_to_zip} = '' THEN bill_to_zip ELSE ${r.bill_to_zip} END,
          contact_name = CASE WHEN ${r.contact_name} = '' THEN contact_name ELSE ${r.contact_name} END,
          contact_email = CASE WHEN ${r.contact_email} = '' THEN contact_email ELSE ${r.contact_email} END,
          contact_phone = CASE WHEN ${r.contact_phone} = '' THEN contact_phone ELSE ${r.contact_phone} END
          WHERE id = ${existing.id}`;
        updated++;
      } else {
        await tx`INSERT INTO customers (name, bill_to_address1, bill_to_address2, bill_to_city, bill_to_state, bill_to_zip, contact_name, contact_email, contact_phone)
          VALUES (${r.name}, ${r.bill_to_address1}, ${r.bill_to_address2}, ${r.bill_to_city}, ${r.bill_to_state}, ${r.bill_to_zip}, ${r.contact_name}, ${r.contact_email}, ${r.contact_phone})`;
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });
  if (counts.inserted + counts.updated > 0) {
    await writeAudit({ userId, entityType: 'customer', entityId: 'bulk', action: 'import', summary: `Imported customers from xlsx: ${counts.inserted} new, ${counts.updated} updated, ${counts.skipped} skipped` });
  }
  return counts;
}

// ─── Importer: Time entries ────────────────────────────────────────────────
//
// Accepts two row shapes; the parser detects which by sniffing the headers.
//
//   Per-day (one row = one date):
//     Date | Employee | Job Code | ST | OT | DT
//
//   Weekly grid (legacy Time Recap shape — one row = one (employee, job, week)):
//     Week Of | Employee | Job Code | Mon ST | Mon OT | Mon DT | ... | Sun DT
//     "Week Of" must be a Monday (we reject other DOWs with a clear error).
//
// In both shapes we upsert by (employee_id, job_id, work_date) since
// time_entries has that unique constraint. A row with all-zero hours is
// skipped (matches the no-all-zero rule the API enforces).

interface TimeEntryRow {
  work_date: string;
  employee: string;
  job_code: string;
  st_hours: number;
  ot_hours: number;
  dt_hours: number;
}

function isWeeklyShape(headers: string[]): boolean {
  // Any day-prefixed column triggers weekly parsing.
  return headers.some((h) => /^(mon|tue|tues|wed|wednesday|thu|thur|thursday|fri|sat|sun)/.test(h));
}

// Maps normalized headers like "mon_st", "mon_1x", "monday_st" to (dow, tier).
function dayTierFromHeader(h: string): { dow: number; tier: 'st' | 'ot' | 'dt' } | null {
  const m = h.match(/^(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)[_\s-]*(st|ot|dt|1x|15x|2x|straight|over|double)/);
  if (!m) return null;
  const dowMap: Record<string, number> = {
    mon: 0, monday: 0,
    tue: 1, tues: 1, tuesday: 1,
    wed: 2, wednesday: 2,
    thu: 3, thur: 3, thurs: 3, thursday: 3,
    fri: 4, friday: 4,
    sat: 5, saturday: 5,
    sun: 6, sunday: 6,
  };
  const tierMap: Record<string, 'st' | 'ot' | 'dt'> = {
    st: 'st', '1x': 'st', straight: 'st',
    ot: 'ot', '15x': 'ot', over: 'ot',
    dt: 'dt', '2x': 'dt', double: 'dt',
  };
  const dow = dowMap[m[1]];
  const tier = tierMap[m[2]];
  if (dow === undefined || !tier) return null;
  return { dow, tier };
}

function dowOf(yyyymmdd: string): number {
  // Monday=0 .. Sunday=6 (matches the rest of the app).
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  return (d.getUTCDay() + 6) % 7;
}

function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function previewTimeEntries(buffer: Buffer): Promise<PreviewResult<TimeEntryRow>> {
  const sheet = await readFirstNonEmptySheet(buffer);
  const rows: Array<TimeEntryRow & { _row: number; _errors?: string[] }> = [];
  const errors: PreviewError[] = [];

  // Resolve names + codes up front.
  const employees = await sql<{ id: string; name: string; active: boolean }[]>`SELECT id, name, active FROM employees`;
  const empByName = new Map(employees.map((e) => [e.name.toLowerCase(), e]));
  const jobs = await sql<{ id: string; code: string; active: boolean }[]>`SELECT id, code, active FROM jobs`;
  const jobByCode = new Map(jobs.map((j) => [j.code.toLowerCase(), j]));

  const weekly = isWeeklyShape(sheet.headers);
  const dayTierCols: Array<{ key: string; dow: number; tier: 'st' | 'ot' | 'dt' }> = weekly
    ? sheet.headers.flatMap((h) => {
        const dt = dayTierFromHeader(h);
        return dt ? [{ key: h, ...dt }] : [];
      })
    : [];

  function pushOne(rowNum: number, work_date: string, employee: string, job_code: string, st: number, ot: number, dt: number, extraErrors: string[]) {
    const rowErrors: string[] = [...extraErrors];
    if (!work_date) rowErrors.push('Date missing or unparseable');
    if (!employee) rowErrors.push('Employee required');
    else if (!empByName.has(employee.toLowerCase())) rowErrors.push(`Employee "${employee}" not found`);
    else if (!empByName.get(employee.toLowerCase())!.active) rowErrors.push(`Employee "${employee}" is inactive`);
    if (!job_code) rowErrors.push('Job code required');
    else if (!jobByCode.has(job_code.toLowerCase())) rowErrors.push(`Job "${job_code}" not found`);
    else if (!jobByCode.get(job_code.toLowerCase())!.active) rowErrors.push(`Job "${job_code}" is inactive`);
    if (st < 0 || ot < 0 || dt < 0) rowErrors.push('Hours must be non-negative');
    if (st > 24 || ot > 24 || dt > 24) rowErrors.push('Hours exceed 24/day cap');
    if (st + ot + dt === 0) rowErrors.push('All hours are zero — skipping');
    rows.push({
      _row: rowNum, work_date, employee, job_code,
      st_hours: st, ot_hours: ot, dt_hours: dt,
      _errors: rowErrors.length ? rowErrors : undefined,
    });
    for (const m of rowErrors) errors.push({ row: rowNum, message: m });
  }

  for (const r of sheet.rows) {
    const rowNum = r._row as number;
    const employee = toStr(r.employee ?? r.employee_name ?? r.name);
    const job_code = toStr(r.job ?? r.job_code ?? r.jobcode);

    if (weekly) {
      const weekOfStr = toDateStr(r.week_of ?? r.date ?? r.week ?? r.monday);
      const weekErrors: string[] = [];
      let anchorDow = -1;
      if (weekOfStr) {
        anchorDow = dowOf(weekOfStr);
        if (anchorDow !== 0) weekErrors.push(`Week Of must be a Monday (got ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][anchorDow]})`);
      } else {
        weekErrors.push('Week Of date missing or unparseable');
      }
      // Collect day-tier values per (dow): {st, ot, dt}
      const days: Record<number, { st: number; ot: number; dt: number }> = {};
      for (const col of dayTierCols) {
        const v = toNum(r[col.key]) ?? 0;
        const d = (days[col.dow] ??= { st: 0, ot: 0, dt: 0 });
        d[col.tier] = v;
      }
      // Emit one row per day with any non-zero hours (or every day with zero
      // gets the "all hours zero" error if the entire week is empty).
      let anyEmitted = false;
      if (weekOfStr && anchorDow === 0) {
        for (let dow = 0; dow < 7; dow++) {
          const d = days[dow] ?? { st: 0, ot: 0, dt: 0 };
          if (d.st === 0 && d.ot === 0 && d.dt === 0) continue;
          anyEmitted = true;
          pushOne(rowNum, addDays(weekOfStr, dow), employee, job_code, d.st, d.ot, d.dt, []);
        }
      }
      if (!anyEmitted) {
        // Always emit one row to surface errors even if the week is blank/invalid.
        pushOne(rowNum, weekOfStr ?? '', employee, job_code, 0, 0, 0, weekErrors.length ? weekErrors : ['All hours are zero — skipping']);
      }
    } else {
      const work_date = toDateStr(r.date ?? r.work_date ?? r.workdate) ?? '';
      const st = toNum(r.st ?? r.st_hours ?? r.straight ?? r['1x']) ?? 0;
      const ot = toNum(r.ot ?? r.ot_hours ?? r.over ?? r['15x']) ?? 0;
      const dt = toNum(r.dt ?? r.dt_hours ?? r.double ?? r['2x']) ?? 0;
      pushOne(rowNum, work_date, employee, job_code, st, ot, dt, []);
    }
  }
  return { type: 'time-entries', sheet_name: sheet.sheetName + (weekly ? ' (weekly grid)' : ' (per-day)'), total_rows: rows.length, rows, errors };
}

async function commitTimeEntries(rows: Array<TimeEntryRow & { _row: number }>, userId: string | null): Promise<CommitResult> {
  const employees = await sql<{ id: string; name: string }[]>`SELECT id, name FROM employees`;
  const empByName = new Map(employees.map((e) => [e.name.toLowerCase(), e.id]));
  const jobs = await sql<{ id: string; code: string }[]>`SELECT id, code FROM jobs`;
  const jobByCode = new Map(jobs.map((j) => [j.code.toLowerCase(), j.id]));

  const counts = await sql.begin(async (tx: any) => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const empId = empByName.get(r.employee.toLowerCase());
      const jobId = jobByCode.get(r.job_code.toLowerCase());
      if (!empId || !jobId || !r.work_date) { skipped++; continue; }
      if (r.st_hours === 0 && r.ot_hours === 0 && r.dt_hours === 0) { skipped++; continue; }
      // Upsert by (employee, job, date). Importing a row for a (e,j,d) that's
      // already bound to an invoice would corrupt the snapshot — refuse to
      // overwrite billed rows.
      const [existing] = await tx`
        SELECT id, invoice_id FROM time_entries WHERE employee_id = ${empId} AND job_id = ${jobId} AND work_date = ${r.work_date}::date` as { id: string; invoice_id: string | null }[];
      if (existing) {
        if (existing.invoice_id) { skipped++; continue; }
        await tx`UPDATE time_entries SET st_hours = ${r.st_hours}, ot_hours = ${r.ot_hours}, dt_hours = ${r.dt_hours} WHERE id = ${existing.id}`;
        updated++;
      } else {
        await tx`INSERT INTO time_entries (employee_id, job_id, work_date, st_hours, ot_hours, dt_hours)
          VALUES (${empId}, ${jobId}, ${r.work_date}::date, ${r.st_hours}, ${r.ot_hours}, ${r.dt_hours})`;
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });
  if (counts.inserted + counts.updated > 0) {
    await writeAudit({ userId, entityType: 'time_entry', entityId: 'bulk', action: 'import', summary: `Imported time entries from xlsx: ${counts.inserted} new, ${counts.updated} updated, ${counts.skipped} skipped` });
  }
  return counts;
}

// ─── Importer: Jobs ────────────────────────────────────────────────────────

interface JobRow {
  code: string;
  customer: string;        // looked up case-insensitively against customers.name
  description: string;
  po_number: string | null;
  billing_type: 'tm' | 'quote';
  site_address1: string;
  site_address2: string;
  site_city: string;
  site_state: string;
  site_zip: string;
  active: boolean;
  notes: string | null;
}

function normalizeBillingType(v: Cell): 'tm' | 'quote' | null {
  const s = toStr(v).toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 'tm'; // default to T&M when blank
  if (s === 'tm' || s === 'tandm' || s === 'timematerial' || s === 'timematerials' || s === 'timeandmaterials') return 'tm';
  if (s === 'quote' || s === 'fixed' || s === 'fixedprice') return 'quote';
  return null;
}

function normalizeActive(v: Cell): boolean {
  const s = toStr(v).toLowerCase();
  if (s === '' || s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'active') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0' || s === 'inactive') return false;
  return true; // safe default
}

async function previewJobs(buffer: Buffer): Promise<PreviewResult<JobRow>> {
  const sheet = await readFirstNonEmptySheet(buffer);
  const customers = await sql<{ id: string; name: string }[]>`SELECT id, name FROM customers`;
  const custByName = new Map(customers.map((c) => [c.name.toLowerCase(), c]));

  const rows: Array<JobRow & { _row: number; _errors?: string[] }> = [];
  const errors: PreviewError[] = [];
  // Track duplicate codes inside the same sheet — a second occurrence is
  // surfaced as an error so the operator knows the row will overwrite.
  const seenCodes = new Set<string>();

  for (const r of sheet.rows) {
    const rowNum = r._row as number;
    const code = toStr(r.code ?? r.job ?? r.job_code ?? r.jobcode);
    const customer = toStr(r.customer ?? r.customer_name ?? r.client);
    const description = toStr(r.description ?? r.job_description ?? r.desc);
    const po_number = toStr(r.po ?? r.po_number ?? r.purchase_order) || null;
    const billing = normalizeBillingType(r.billing_type ?? r.billing ?? r.type ?? r.t_m_quote);
    const site_address1 = toStr(r.site_address ?? r.site_address1 ?? r.address ?? r.site_street);
    const site_address2 = toStr(r.site_address2 ?? r.address2);
    const site_city = toStr(r.site_city ?? r.city);
    const site_state = toStr(r.site_state ?? r.state);
    const site_zip = toStr(r.site_zip ?? r.zip);
    const active = normalizeActive(r.active ?? r.status);
    const notes = toStr(r.notes ?? r.note) || null;

    const rowErrors: string[] = [];
    if (!code) rowErrors.push('Job code required');
    else if (seenCodes.has(code.toLowerCase())) rowErrors.push(`Duplicate code "${code}" in this sheet`);
    else seenCodes.add(code.toLowerCase());
    if (!customer) rowErrors.push('Customer required');
    else if (!custByName.has(customer.toLowerCase())) rowErrors.push(`Customer "${customer}" not found`);
    if (!description) rowErrors.push('Description required');
    if (!billing) rowErrors.push('Billing type must be "tm" or "quote"');

    rows.push({
      _row: rowNum,
      code,
      customer,
      description,
      po_number,
      billing_type: billing ?? 'tm',
      site_address1, site_address2, site_city, site_state, site_zip,
      active,
      notes,
      _errors: rowErrors.length ? rowErrors : undefined,
    });
    for (const m of rowErrors) errors.push({ row: rowNum, message: m });
  }
  return { type: 'jobs', sheet_name: sheet.sheetName, total_rows: rows.length, rows, errors };
}

async function commitJobs(rows: Array<JobRow & { _row: number }>, userId: string | null): Promise<CommitResult> {
  const customers = await sql<{ id: string; name: string }[]>`SELECT id, name FROM customers`;
  const custByName = new Map(customers.map((c) => [c.name.toLowerCase(), c.id]));

  const s = (v: unknown): string => v == null ? '' : String(v);

  // Dedupe by code (last occurrence wins) so a sheet that lists the same code
  // twice doesn't run two conflicting UPDATEs against the same row.
  const byCode = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    if (r.code) byCode.set(r.code.toLowerCase(), r);
  }
  const deduped = Array.from(byCode.values());

  const counts = await sql.begin(async (tx: any) => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const raw of deduped) {
      const customerId = custByName.get(raw.customer.toLowerCase());
      if (!raw.code || !customerId || !raw.description) { skipped++; continue; }
      const r = {
        code: s(raw.code),
        description: s(raw.description),
        po_number: raw.po_number,
        billing_type: raw.billing_type,
        site_address1: s(raw.site_address1),
        site_address2: s(raw.site_address2),
        site_city: s(raw.site_city),
        site_state: s(raw.site_state),
        site_zip: s(raw.site_zip),
        active: raw.active,
        notes: raw.notes,
      };
      // citext makes code uniqueness case-insensitive at the column level.
      const [existing] = await tx`SELECT id FROM jobs WHERE code = ${r.code}::citext LIMIT 1` as { id: string }[];
      if (existing) {
        await tx`UPDATE jobs SET
          customer_id = ${customerId},
          description = ${r.description},
          po_number = ${r.po_number},
          billing_type = ${r.billing_type}::billing_type,
          site_address1 = CASE WHEN ${r.site_address1} = '' THEN site_address1 ELSE ${r.site_address1} END,
          site_address2 = CASE WHEN ${r.site_address2} = '' THEN site_address2 ELSE ${r.site_address2} END,
          site_city = CASE WHEN ${r.site_city} = '' THEN site_city ELSE ${r.site_city} END,
          site_state = CASE WHEN ${r.site_state} = '' THEN site_state ELSE ${r.site_state} END,
          site_zip = CASE WHEN ${r.site_zip} = '' THEN site_zip ELSE ${r.site_zip} END,
          active = ${r.active},
          notes = CASE WHEN ${r.notes ?? ''} = '' THEN notes ELSE ${r.notes} END
          WHERE id = ${existing.id}`;
        updated++;
      } else {
        await tx`INSERT INTO jobs (code, customer_id, description, po_number, billing_type, site_address1, site_address2, site_city, site_state, site_zip, active, notes)
          VALUES (${r.code}, ${customerId}, ${r.description}, ${r.po_number}, ${r.billing_type}::billing_type, ${r.site_address1}, ${r.site_address2}, ${r.site_city}, ${r.site_state}, ${r.site_zip}, ${r.active}, ${r.notes})`;
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });
  if (counts.inserted + counts.updated > 0) {
    await writeAudit({ userId, entityType: 'job', entityId: 'bulk', action: 'import', summary: `Imported jobs from xlsx: ${counts.inserted} new, ${counts.updated} updated, ${counts.skipped} skipped` });
  }
  return counts;
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

export async function previewImport(type: ImportType, buffer: Buffer): Promise<PreviewResult> {
  switch (type) {
    case 'expenses': return previewExpenses(buffer);
    case 'customers': return previewCustomers(buffer);
    case 'jobs': return previewJobs(buffer);
    case 'time-entries': return previewTimeEntries(buffer);
    default: throw new Error(`Unknown import type: ${type}`);
  }
}

export async function commitImport(type: ImportType, rows: any[], userId: string | null): Promise<CommitResult> {
  switch (type) {
    case 'expenses': return commitExpenses(rows, userId);
    case 'customers': return commitCustomers(rows, userId);
    case 'jobs': return commitJobs(rows, userId);
    case 'time-entries': return commitTimeEntries(rows, userId);
    default: throw new Error(`Unknown import type: ${type}`);
  }
}

export const IMPORTER_TYPES: { value: ImportType; label: string; columns: string[] }[] = [
  {
    value: 'expenses',
    label: 'Expenses',
    columns: ['Date', 'Vendor', 'Reference', 'Category', 'Job (Code)', 'Amount', 'Description'],
  },
  {
    value: 'customers',
    label: 'Customers',
    columns: ['Name', 'Address1', 'Address2', 'City', 'State', 'Zip', 'Contact Name', 'Email', 'Phone'],
  },
  {
    value: 'jobs',
    label: 'Jobs',
    columns: ['Code', 'Customer', 'Description', 'PO Number', 'Billing Type (tm | quote)', 'Site Address', 'City', 'State', 'Zip', 'Active', 'Notes'],
  },
  {
    value: 'time-entries',
    label: 'Time Entries',
    columns: [
      'Per-day shape: Date | Employee | Job Code | ST | OT | DT',
      'Weekly shape: Week Of (Monday) | Employee | Job Code | Mon ST | Mon OT | Mon DT | … | Sun DT',
    ],
  },
];
