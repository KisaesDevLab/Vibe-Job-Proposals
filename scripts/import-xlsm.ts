/**
 * Historical XLSM importer (Phase 18). Idempotent; keyed off natural identifiers.
 * Usage: npx tsx scripts/import-xlsm.ts <path> [--dry-run] [--only=customers,jobs,...]
 */
import ExcelJS from 'exceljs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  sql,
  parseJobCode,
  excelToDate,
  levelNameFromLabel,
  categoryFromAccount,
  COMPANY_CODE_NAMES,
} from '@darrow/db';
import {
  priceTimeEntry,
  priceExpenseEntry,
  computeInvoiceTotals,
  EXPENSE_CATEGORY_LABELS,
  TIER_LABELS,
} from '@darrow/shared';

interface Report {
  counts: Record<string, { created: number; updated: number; skipped: number }>;
  warnings: string[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function rowsOf(ws: ExcelJS.Worksheet): Record<string, any>[] {
  const headers = (ws.getRow(1).values as any[]).slice(1).map((h) => String(h ?? '').trim());
  const out: Record<string, any>[] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const vals = (ws.getRow(i).values as any[]).slice(1);
    const obj: Record<string, any> = {};
    headers.forEach((h, j) => (obj[h] = vals[j]));
    out.push(obj);
  }
  return out;
}

export async function runImport(path: string, opts: { dryRun?: boolean; only?: string[] } = {}): Promise<Report> {
  const report: Report = { counts: {}, warnings: [] };
  const bump = (k: string, f: 'created' | 'updated' | 'skipped') => {
    report.counts[k] ??= { created: 0, updated: 0, skipped: 0 };
    report.counts[k][f]++;
  };
  const want = (step: string) => !opts.only || opts.only.includes(step);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const codeToCustomer = new Map<string, string>(); // code -> customer_id
  const customerByName = new Map<string, string>();

  async function upsertCustomer(name: string, active = true): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO customers (name, active, imported_from_xlsm) VALUES (${name}, ${active}, true)
      ON CONFLICT (name) DO UPDATE SET imported_from_xlsm = true RETURNING id`;
    return row.id;
  }

  // Step 1 — Companies
  if (want('customers')) {
    const ws = wb.getWorksheet('Companies');
    for (const r of ws ? rowsOf(ws) : []) {
      const code = String(r.Code ?? '').trim();
      const name = String(r.Name ?? '').trim();
      if (!name) continue;
      if (opts.dryRun) { bump('customers', 'skipped'); continue; }
      const id = await upsertCustomer(name);
      customerByName.set(name, id);
      if (code) codeToCustomer.set(code.toUpperCase(), id);
      bump('customers', 'created');
    }
  }
  // ensure code map even if we skipped writes (for downstream steps)
  if (codeToCustomer.size === 0 && !opts.dryRun) {
    for (const [code, name] of Object.entries(COMPANY_CODE_NAMES)) {
      const [c] = await sql<{ id: string }[]>`SELECT id FROM customers WHERE name=${name}`;
      if (c) codeToCustomer.set(code.toUpperCase(), c.id);
    }
  }

  // Step 2 — Employees + cost rate 0
  const empByName = new Map<string, string>();
  if (want('employees') && !opts.dryRun) {
    const ws = wb.getWorksheet('Employee Active');
    for (const r of ws ? rowsOf(ws) : []) {
      const name = String(r.Name ?? '').trim();
      if (!name) continue;
      const levelName = levelNameFromLabel(r.Level);
      const [lvl] = await sql<{ id: string }[]>`SELECT id FROM rate_levels WHERE name=${levelName}`;
      const levelId = lvl?.id ?? (await sql<{ id: string }[]>`SELECT id FROM rate_levels ORDER BY sort_order LIMIT 1`)[0].id;
      const [e] = await sql<{ id: string }[]>`
        INSERT INTO employees (name, level_id, imported_from_xlsm) VALUES (${name}, ${levelId}, true)
        ON CONFLICT (lower(name)) DO UPDATE SET level_id=EXCLUDED.level_id, imported_from_xlsm=true RETURNING id`;
      empByName.set(name, e.id);
      const existing = await sql`SELECT id FROM employee_cost_rates WHERE employee_id=${e.id}`;
      if (existing.length === 0) {
        await sql`INSERT INTO employee_cost_rates (employee_id, effective_from, cost_st, cost_ot, cost_dt) VALUES (${e.id}, '1900-01-01', 0, 0, 0)`;
      }
      report.warnings.push(`Employee "${name}": cost rate = 0, REQUIRES manual entry.`);
      bump('employees', 'created');
    }
  }

  // Step 3 — derived rate schedules from Defaults
  if (want('schedules') && !opts.dryRun) {
    const ws = wb.getWorksheet('Defaults');
    const byCust = new Map<string, { Level: string; Rate1x: number; Rate15x: number; Rate2x: number }[]>();
    for (const r of ws ? rowsOf(ws) : []) {
      const cust = String(r.Customer ?? '').trim();
      if (!cust) continue;
      (byCust.get(cust) ?? byCust.set(cust, []).get(cust)!).push({ Level: String(r.Level), Rate1x: Number(r.Rate1x), Rate15x: Number(r.Rate15x), Rate2x: Number(r.Rate2x) });
    }
    for (const [cust, lines] of byCust) {
      const cid = customerByName.get(cust) ?? (await sql<{ id: string }[]>`SELECT id FROM customers WHERE name=${cust}`)[0]?.id;
      if (!cid) { report.warnings.push(`Defaults references unknown customer "${cust}"`); continue; }
      const existing = await sql`SELECT id FROM rate_schedules WHERE customer_id=${cid} AND imported_from_xlsm=true`;
      let schedId: string;
      if (existing.length) schedId = existing[0].id as string;
      else {
        const [s] = await sql<{ id: string }[]>`INSERT INTO rate_schedules (customer_id, name, effective_from, imported_from_xlsm, notes) VALUES (${cid}, 'Legacy (derived)', '1900-01-01', true, 'derived from legacy data — REVIEW before issuing new invoices') RETURNING id`;
        schedId = s.id;
      }
      for (const ln of lines) {
        const levelName = levelNameFromLabel(ln.Level);
        const [lvl] = await sql<{ id: string }[]>`SELECT id FROM rate_levels WHERE name=${levelName}`;
        if (!lvl) continue;
        await sql`INSERT INTO rate_schedule_lines (schedule_id, level_id, rate_1x, rate_15x, rate_2x) VALUES (${schedId}, ${lvl.id}, ${ln.Rate1x}, ${ln.Rate15x}, ${ln.Rate2x})
          ON CONFLICT (schedule_id, level_id) DO UPDATE SET rate_1x=EXCLUDED.rate_1x, rate_15x=EXCLUDED.rate_15x, rate_2x=EXCLUDED.rate_2x`;
      }
      await sql`UPDATE customers SET default_rate_schedule_id=${schedId} WHERE id=${cid}`;
      report.warnings.push(`Schedule for "${cust}": derived from legacy data — REVIEW before issuing new invoices.`);
      bump('schedules', 'created');
    }
  }

  // Step 4 — Jobs
  const jobByBase = new Map<string, string>();
  if (want('jobs') && !opts.dryRun) {
    const ws = wb.getWorksheet('Job Codes');
    for (const r of ws ? rowsOf(ws) : []) {
      const code = String(r.Code ?? '').trim();
      if (!code) continue;
      const parsed = parseJobCode(code);
      let cid = codeToCustomer.get(parsed.customer_code);
      if (!cid) {
        const placeholder = `Unknown (${parsed.customer_code})`;
        cid = await upsertCustomer(placeholder, false);
        codeToCustomer.set(parsed.customer_code, cid);
        report.warnings.push(`Unmapped customer code "${parsed.customer_code}" (job ${code}) -> placeholder "${placeholder}".`);
      }
      const billingType = /quote/i.test(String(r['T/M Quote'] ?? '')) ? 'quote' : 'tm';
      const desc = String(r.Description ?? '').trim() || parsed.base_code;
      const [j] = await sql<{ id: string }[]>`
        INSERT INTO jobs (code, customer_id, description, billing_type, imported_from_xlsm) VALUES (${parsed.base_code}, ${cid}, ${desc}, ${billingType}, true)
        ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description, billing_type=EXCLUDED.billing_type, imported_from_xlsm=true RETURNING id`;
      jobByBase.set(parsed.base_code.toUpperCase(), j.id);
      bump('jobs', 'created');
    }
  }

  // Step 5 — Time Recap -> daily entries (carry billed marker)
  const timeMarkers: { id: string; marker: string }[] = [];
  if (want('time') && !opts.dryRun) {
    const ws = wb.getWorksheet('Time Recap');
    for (const r of ws ? rowsOf(ws) : []) {
      const empName = String(r.Employee ?? '').trim();
      const jobCode = String(r.Job ?? '').trim();
      const anchor = excelToDate(r.Date);
      if (empName === 'AAA' || !empName || !jobCode || !anchor) { bump('time', 'skipped'); continue; }
      const empId = empByName.get(empName) ?? (await sql<{ id: string }[]>`SELECT id FROM employees WHERE lower(name)=lower(${empName})`)[0]?.id;
      const parsed = parseJobCode(jobCode);
      const jobId = jobByBase.get(parsed.base_code.toUpperCase()) ?? (await sql<{ id: string }[]>`SELECT id FROM jobs WHERE code=${parsed.base_code}`)[0]?.id;
      if (!empId || !jobId) { report.warnings.push(`Time Recap: cannot resolve emp="${empName}" job="${jobCode}"`); bump('time', 'skipped'); continue; }
      const marker = String(r.Billed ?? '').trim();
      for (let d = 0; d < 7; d++) {
        const st = Number(r[`${DAYS[d]}_ST`] ?? 0) || 0;
        const ot = Number(r[`${DAYS[d]}_OT`] ?? 0) || 0;
        const dt = Number(r[`${DAYS[d]}_DT`] ?? 0) || 0;
        if (st <= 0 && ot <= 0 && dt <= 0) continue;
        const wd = new Date(new Date(anchor + 'T00:00:00Z').getTime() + d * 86400000).toISOString().slice(0, 10);
        const [te] = await sql<{ id: string }[]>`
          INSERT INTO time_entries (employee_id, job_id, work_date, st_hours, ot_hours, dt_hours, imported_from_xlsm) VALUES (${empId}, ${jobId}, ${wd}, ${st}, ${ot}, ${dt}, true)
          ON CONFLICT (employee_id, job_id, work_date) DO UPDATE SET st_hours=EXCLUDED.st_hours, ot_hours=EXCLUDED.ot_hours, dt_hours=EXCLUDED.dt_hours RETURNING id`;
        if (marker) timeMarkers.push({ id: te.id, marker });
        bump('time', 'created');
      }
    }
  }

  // Step 6 — Billed -> historical invoices (dedup, verbatim reference)
  if (want('invoices') && !opts.dryRun) {
    const ws = wb.getWorksheet('Billed');
    const seen = new Set<string>();
    for (const r of ws ? rowsOf(ws) : []) {
      const ref = String(r.Billed ?? '').trim();
      const jobCode = String(r.Job ?? '').trim();
      if (!ref) continue;
      if (seen.has(ref)) { bump('invoices', 'skipped'); continue; }
      seen.add(ref);
      const parsed = parseJobCode(jobCode || ref);
      const jobId = jobByBase.get(parsed.base_code.toUpperCase()) ?? (await sql<{ id: string }[]>`SELECT id FROM jobs WHERE code=${parsed.base_code}`)[0]?.id;
      if (!jobId) { report.warnings.push(`Billed: cannot resolve job for "${ref}"`); bump('invoices', 'skipped'); continue; }
      const seqNum = parsed.billed_suffix && /^\d+$/.test(parsed.billed_suffix) ? parseInt(parsed.billed_suffix, 10) : null;
      const existing = await sql`SELECT id FROM invoices WHERE billed_reference=${ref}`;
      if (existing.length) { bump('invoices', 'updated'); continue; }
      await sql`INSERT INTO invoices (job_id, billed_reference, sequence_number, status, through_date, finalized_at, imported_from_xlsm)
        VALUES (${jobId}, ${ref}, ${seqNum}, 'finalized', '1900-01-01', now(), true)`;
      bump('invoices', 'created');
    }
    // Step 6b — bind time entries by marker
    for (const { id, marker } of timeMarkers) {
      const [inv] = await sql<{ id: string }[]>`SELECT id FROM invoices WHERE billed_reference=${marker}`;
      if (inv) await sql`UPDATE time_entries SET invoice_id=${inv.id} WHERE id=${id}`;
      else report.warnings.push(`Unmatched billed marker "${marker}" on a time entry (left unbilled).`);
    }
  }

  // Step 7 — Import From AW -> expenses
  if (want('expenses') && !opts.dryRun) {
    const ws = wb.getWorksheet('Import From AW');
    for (const r of ws ? rowsOf(ws) : []) {
      const jobRaw = String(r.Job ?? '').trim();
      if (!jobRaw) { bump('expenses', 'skipped'); continue; }
      const parsed = parseJobCode(jobRaw);
      const jobId = jobByBase.get(parsed.base_code.toUpperCase()) ?? (await sql<{ id: string }[]>`SELECT id FROM jobs WHERE code=${parsed.base_code}`)[0]?.id;
      if (!jobId) { report.warnings.push(`AW: cannot resolve job "${jobRaw}" (skipped)`); bump('expenses', 'skipped'); continue; }
      const wd = excelToDate(r.Date) ?? '1900-01-01';
      const vendor = String(r.Description ?? '').trim() || 'Unknown';
      const reference = String(r.Reference ?? '').trim() || null;
      const amount = Math.abs(Number(r.Amount ?? 0));
      if (amount <= 0) { bump('expenses', 'skipped'); continue; }
      const cat = categoryFromAccount(r.Account);
      if (cat.fallback) report.warnings.push(`AW row "${vendor}" account "${r.Account}" -> materials (fallback).`);
      const dup = await sql`SELECT id FROM expenses WHERE vendor=${vendor} AND COALESCE(reference,'')=${reference ?? ''} AND work_date=${wd} AND amount=${amount}`;
      if (dup.length) { bump('expenses', 'updated'); continue; }
      const [exp] = await sql<{ id: string }[]>`INSERT INTO expenses (work_date, job_id, vendor, reference, amount, category, imported_from_xlsm) VALUES (${wd}, ${jobId}, ${vendor}, ${reference}, ${amount}, ${cat.category}, true) RETURNING id`;
      if (parsed.billed_suffix) {
        const [inv] = await sql<{ id: string }[]>`SELECT id FROM invoices WHERE billed_reference=${parsed.raw}`;
        if (inv) await sql`UPDATE expenses SET invoice_id=${inv.id} WHERE id=${exp.id}`;
      }
      bump('expenses', 'created');
    }
  }

  // Step 6c — snapshot historical invoices (best-effort) AFTER time + expenses are bound.
  if (want('invoices') && want('snapshot') && !opts.dryRun) {
    const invs = await sql<any[]>`SELECT i.id, j.customer_id FROM invoices i JOIN jobs j ON j.id=i.job_id WHERE i.imported_from_xlsm=true`;
    for (const inv of invs) await snapshotHistorical(inv.id, inv.customer_id);
  }

  return report;
}

// Best-effort historical snapshot reusing the pure pricing engine + sql lookups.
async function snapshotHistorical(invoiceId: string, customerId: string): Promise<void> {
  const existing = await sql`SELECT 1 FROM invoice_line_items WHERE invoice_id=${invoiceId} LIMIT 1`;
  if (existing.length) return; // idempotent
  const time = await sql<any[]>`SELECT te.*, e.name AS employee_name, e.level_id FROM time_entries te JOIN employees e ON e.id=te.employee_id WHERE te.invoice_id=${invoiceId}`;
  const exp = await sql<any[]>`SELECT * FROM expenses WHERE invoice_id=${invoiceId}`;
  const priceT = [];
  let order = 0;
  const lines: any[] = [];
  for (const t of time) {
    const [sch] = await sql<any[]>`SELECT rsl.rate_1x, rsl.rate_15x, rsl.rate_2x FROM rate_schedules rs JOIN rate_schedule_lines rsl ON rsl.schedule_id=rs.id WHERE rs.customer_id=${customerId} AND rsl.level_id=${t.level_id} ORDER BY rs.effective_from LIMIT 1`;
    const bill = sch ? { rate_1x: Number(sch.rate_1x), rate_15x: Number(sch.rate_15x), rate_2x: Number(sch.rate_2x) } : { rate_1x: 0, rate_15x: 0, rate_2x: 0 };
    const p = priceTimeEntry({ st_hours: Number(t.st_hours), ot_hours: Number(t.ot_hours), dt_hours: Number(t.dt_hours) }, bill, { cost_st: 0, cost_ot: 0, cost_dt: 0 });
    priceT.push(p);
    for (const tr of p.tiers) lines.push({ line_type: 'labor', employee_id: t.employee_id, description: `${t.employee_name} – ${TIER_LABELS[tr.tier]}`, tier: tr.tier, quantity: tr.hours, unit_rate: tr.rate, amount: tr.amount, cost_amount: tr.cost });
  }
  if (lines.length) lines.push({ line_type: 'labor_subtotal', description: 'Labor Subtotal', amount: priceT.reduce((a, p) => a + p.total, 0), cost_amount: 0 });
  const priceE = exp.map((e) => priceExpenseEntry({ category: e.category, amount: Number(e.amount) }, 0));
  for (let i = 0; i < exp.length; i++) lines.push({ line_type: 'expense', category: exp[i].category, expense_id: exp[i].id, description: `${EXPENSE_CATEGORY_LABELS[exp[i].category as keyof typeof EXPENSE_CATEGORY_LABELS]} – ${exp[i].vendor}`, amount: priceE[i].amount, cost_amount: priceE[i].amount });
  const totals = computeInvoiceTotals(priceT, priceE);
  lines.push({ line_type: 'grand_total', description: 'Grand Total', amount: totals.grand_total, cost_amount: null });
  for (const l of lines) {
    await sql`INSERT INTO invoice_line_items (invoice_id, line_order, line_type, category, employee_id, expense_id, description, tier, quantity, unit_rate, amount, cost_amount)
      VALUES (${invoiceId}, ${order++}, ${l.line_type}, ${l.category ?? null}, ${l.employee_id ?? null}, ${l.expense_id ?? null}, ${l.description}, ${l.tier ?? null}, ${l.quantity ?? null}, ${l.unit_rate ?? null}, ${l.amount}, ${l.cost_amount ?? null})`;
  }
  await sql`UPDATE invoices SET total_labor=${totals.total_labor}, total_labor_cost=${totals.total_labor_cost}, total_materials=${totals.total_materials}, total_equipment_rent=${totals.total_equipment_rent}, total_markup=${totals.total_markup}, total_expense_cost=${totals.total_expense_cost}, grand_total=${totals.grand_total} WHERE id=${invoiceId}`;
}

function renderReport(report: Report): string {
  const lines = ['# Sample Import Report', '', `Generated ${new Date().toISOString()}`, '', '## Counts', '', '| Entity | Created | Updated | Skipped |', '|---|---|---|---|'];
  for (const [k, v] of Object.entries(report.counts)) lines.push(`| ${k} | ${v.created} | ${v.updated} | ${v.skipped} |`);
  lines.push('', '## Warnings', '');
  const uniq = [...new Set(report.warnings)];
  if (uniq.length === 0) lines.push('_None_');
  for (const w of uniq) lines.push(`- ${w}`);
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1].split(',');
  if (!path) { console.error('usage: import-xlsm <path> [--dry-run] [--only=...]'); process.exit(1); }
  console.log(`[import] reading ${path}${dryRun ? ' (dry-run)' : ''}`);
  runImport(path, { dryRun, only })
    .then(async (report) => {
      const md = renderReport(report);
      const dir = join(process.env.STORAGE_ROOT ?? '/storage', 'imports');
      mkdirSync(dir, { recursive: true });
      const logPath = join(dir, `${Date.now()}.log`);
      writeFileSync(logPath, md);
      writeFileSync(join(process.cwd(), 'docs', 'sample-import-report.md'), md);
      console.log(md);
      console.log(`[import] report -> ${logPath} and docs/sample-import-report.md`);
      await sql.end({ timeout: 5 });
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[import] failed', err);
      await sql.end({ timeout: 5 });
      process.exit(1);
    });
}
