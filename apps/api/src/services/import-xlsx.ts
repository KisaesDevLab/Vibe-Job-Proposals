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
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@darrow/shared';
import { writeAudit } from '../audit.js';

export type ImportType = 'expenses' | 'customers';

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
    if ('result' in v) return cellValue((v as any).result);
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
      // Accept either an enum value or its display label.
      const norm = categoryRaw.replace(/[^a-z]/g, '');
      const match = (EXPENSE_CATEGORIES as readonly string[]).find((c) => c.replace(/_/g, '') === norm);
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
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const jobId = jobByCode.get(r.job_code.toLowerCase());
    if (!jobId || !r.work_date || !r.vendor || !r.amount) { skipped++; continue; }
    await sql`INSERT INTO expenses (work_date, job_id, vendor, reference, amount, category, description)
      VALUES (${r.work_date}::date, ${jobId}, ${r.vendor}, ${r.reference}, ${r.amount}, ${r.category}, ${r.description})`;
    inserted++;
  }
  if (inserted > 0) {
    await writeAudit({ userId, entityType: 'expense', entityId: 'bulk', action: 'import', summary: `Imported ${inserted} expense(s) from xlsx; ${skipped} skipped` });
  }
  return { inserted, updated: 0, skipped };
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
  let inserted = 0; let updated = 0; let skipped = 0;
  // Coerce every text field to a string up front so the UPDATE's parameter
  // binding never sees `undefined` (postgres.js rejects undefined).
  const s = (v: unknown): string => v == null ? '' : String(v);
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
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM customers WHERE lower(name) = lower(${r.name}) LIMIT 1`;
    if (existing) {
      await sql`UPDATE customers SET
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
      await sql`INSERT INTO customers (name, bill_to_address1, bill_to_address2, bill_to_city, bill_to_state, bill_to_zip, contact_name, contact_email, contact_phone)
        VALUES (${r.name}, ${r.bill_to_address1}, ${r.bill_to_address2}, ${r.bill_to_city}, ${r.bill_to_state}, ${r.bill_to_zip}, ${r.contact_name}, ${r.contact_email}, ${r.contact_phone})`;
      inserted++;
    }
  }
  if (inserted + updated > 0) {
    await writeAudit({ userId, entityType: 'customer', entityId: 'bulk', action: 'import', summary: `Imported customers from xlsx: ${inserted} new, ${updated} updated, ${skipped} skipped` });
  }
  return { inserted, updated, skipped };
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

export async function previewImport(type: ImportType, buffer: Buffer): Promise<PreviewResult> {
  switch (type) {
    case 'expenses': return previewExpenses(buffer);
    case 'customers': return previewCustomers(buffer);
    default: throw new Error(`Unknown import type: ${type}`);
  }
}

export async function commitImport(type: ImportType, rows: any[], userId: string | null): Promise<CommitResult> {
  switch (type) {
    case 'expenses': return commitExpenses(rows, userId);
    case 'customers': return commitCustomers(rows, userId);
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
];
