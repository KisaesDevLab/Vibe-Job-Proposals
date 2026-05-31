// Invoice preview, finalize-readiness validation, and snapshot — Phases 12/13.
import { sql as rawsql } from '@darrow/db';
import {
  priceTimeEntry,
  priceExpenseEntry,
  computeInvoiceTotals,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  TIER_LABELS,
  type ExpenseCategory,
  type PricedTimeEntry,
  type PricedExpense,
  type Tier,
} from '@darrow/shared';
import { getRateAt, getCostRateAt, getMarkupPercent } from './lookup.js';

interface BoundTime {
  id: string;
  employee_id: string;
  employee_name: string;
  level_id: string;
  work_date: string;
  st_hours: number;
  ot_hours: number;
  dt_hours: number;
}
interface BoundExpense {
  id: string;
  work_date: string;
  vendor: string;
  description: string | null;
  amount: number;
  category: ExpenseCategory;
}

export interface Blocker {
  kind: string;
  message: string;
  entity_id?: string;
}

export interface InvoicePreview {
  invoice_id: string;
  job_id: string;
  customer_id: string;
  labor_lines: Array<{
    time_entry_id: string;
    employee_id: string;
    employee_name: string;
    tier: Tier;
    tier_label: string;
    hours: number;
    rate: number;
    amount: number;
    cost_amount: number;
  }>;
  expense_lines: Array<{
    expense_id: string;
    category: ExpenseCategory;
    category_label: string;
    vendor: string;
    description: string | null;
    amount: number;
    markup_percent: number;
    markup_amount: number;
    total: number;
    markup_source: string;
  }>;
  totals: ReturnType<typeof computeInvoiceTotals>;
  blockers: Blocker[];
}

async function loadInvoiceContext(invoiceId: string) {
  const [inv] = await rawsql<any[]>`
    SELECT i.*, j.customer_id, j.code AS job_code FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE i.id = ${invoiceId}`;
  if (!inv) return null;
  const time = await rawsql<BoundTime[]>`
    SELECT te.id, te.employee_id, e.name AS employee_name, e.level_id,
           te.work_date::text AS work_date, te.st_hours, te.ot_hours, te.dt_hours
    FROM time_entries te JOIN employees e ON e.id = te.employee_id
    WHERE te.invoice_id = ${invoiceId} ORDER BY te.work_date, e.name`;
  const exp = await rawsql<BoundExpense[]>`
    SELECT id, work_date::text AS work_date, vendor, description, amount, category
    FROM expenses WHERE invoice_id = ${invoiceId} ORDER BY category, work_date`;
  const overrides = await rawsql<{ category: ExpenseCategory; percent: string }[]>`
    SELECT category, percent FROM invoice_markup_overrides WHERE invoice_id = ${invoiceId}`;
  const overrideMap = new Map(overrides.map((o) => [o.category, Number(o.percent)]));
  return { inv, time, exp, overrideMap, customerId: inv.customer_id as string };
}

export async function buildPreview(invoiceId: string): Promise<InvoicePreview | null> {
  const ctx = await loadInvoiceContext(invoiceId);
  if (!ctx) return null;
  const { inv, time, exp, overrideMap, customerId } = ctx;
  const blockers: Blocker[] = [];
  const laborLines: InvoicePreview['labor_lines'] = [];
  const pricedTime: PricedTimeEntry[] = [];

  for (const t of time) {
    const rate = await getRateAt(customerId, t.level_id, t.work_date);
    const cost = await getCostRateAt(t.employee_id, t.work_date);
    if ('error' in rate) {
      blockers.push({ kind: rate.error, message: `${t.employee_name} (${t.work_date}): ${rate.detail}`, entity_id: t.id });
      continue;
    }
    if ('error' in cost) {
      blockers.push({ kind: cost.error, message: `${t.employee_name} (${t.work_date}): ${cost.detail}`, entity_id: t.id });
      continue;
    }
    const priced = priceTimeEntry(
      { st_hours: Number(t.st_hours), ot_hours: Number(t.ot_hours), dt_hours: Number(t.dt_hours) },
      rate,
      cost,
    );
    pricedTime.push(priced);
    for (const tr of priced.tiers) {
      laborLines.push({
        time_entry_id: t.id,
        employee_id: t.employee_id,
        employee_name: t.employee_name,
        tier: tr.tier,
        tier_label: TIER_LABELS[tr.tier],
        hours: tr.hours,
        rate: tr.rate,
        amount: tr.amount,
        cost_amount: tr.cost,
      });
    }
  }

  const expenseLines: InvoicePreview['expense_lines'] = [];
  const pricedExp: PricedExpense[] = [];
  for (const e of exp) {
    const mk = await getMarkupPercent(customerId, e.category, overrideMap.get(e.category) ?? null);
    const priced = priceExpenseEntry({ category: e.category, amount: Number(e.amount) }, mk.percent);
    pricedExp.push(priced);
    expenseLines.push({
      expense_id: e.id,
      category: e.category,
      category_label: EXPENSE_CATEGORY_LABELS[e.category],
      vendor: e.vendor,
      description: e.description,
      amount: priced.amount,
      markup_percent: priced.markup_percent,
      markup_amount: priced.markup_amount,
      total: priced.total,
      markup_source: mk.source,
    });
  }

  // pending/failed attachment blocker
  const badAtt = await rawsql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM expense_attachments a
    JOIN expenses e ON e.id = a.expense_id
    WHERE e.invoice_id = ${invoiceId} AND a.status != 'ready'`;
  if (badAtt[0].n > 0) {
    blockers.push({ kind: 'attachment_not_ready', message: `${badAtt[0].n} attachment(s) still converting or failed` });
  }
  if (time.length === 0 && exp.length === 0) {
    blockers.push({ kind: 'empty', message: 'No time or expense entries selected' });
  }

  const totals = computeInvoiceTotals(pricedTime, pricedExp);
  return {
    invoice_id: invoiceId,
    job_id: inv.job_id,
    customer_id: customerId,
    labor_lines: laborLines,
    expense_lines: expenseLines,
    totals,
    blockers,
  };
}

export async function finalizeInvoice(invoiceId: string, userId: string | null): Promise<{ billed_reference: string; sequence_number: number }> {
  const preview = await buildPreview(invoiceId);
  if (!preview) throw Object.assign(new Error('Invoice not found'), { status: 404, code: 'not_found' });
  if (preview.blockers.length > 0) {
    throw Object.assign(new Error('Finalize blocked'), { status: 422, code: 'blocked', details: preview.blockers });
  }

  return rawsql.begin(async (tx: any) => {
    const [inv] = await tx`SELECT i.*, j.code AS job_code FROM invoices i JOIN jobs j ON j.id=i.job_id WHERE i.id=${invoiceId}`;
    if (inv.status !== 'draft') throw Object.assign(new Error('Not a draft'), { status: 409, code: 'not_draft' });

    // Serialize sequence assignment per job by locking the job row first
    // (FOR UPDATE is not permitted alongside an aggregate query).
    // NB: MAX is taken over ALL invoices for the job (including 'void') so a
    // voided invoice's sequence number is retained and never reused — this
    // honors the Phase 16 acceptance criteria ("sequence numbers skip voided
    // invoices"), which take precedence over the Phase 13 task-3 sample SQL.
    await tx`SELECT id FROM jobs WHERE id=${inv.job_id} FOR UPDATE`;
    const [{ next }] = await tx`SELECT COALESCE(MAX(sequence_number),0)+1 AS next FROM invoices WHERE job_id=${inv.job_id}`;
    const seq = Number(next);
    const billedReference = `${inv.job_code}.${String(seq).padStart(2, '0')}`;

    // snapshot line items
    let order = 0;
    const ins = async (row: any) =>
      tx`INSERT INTO invoice_line_items (invoice_id, line_order, line_type, category, employee_id, expense_id, description, tier, quantity, unit_rate, amount, cost_amount)
         VALUES (${invoiceId}, ${order++}, ${row.line_type}, ${row.category ?? null}, ${row.employee_id ?? null}, ${row.expense_id ?? null}, ${row.description}, ${row.tier ?? null}, ${row.quantity ?? null}, ${row.unit_rate ?? null}, ${row.amount}, ${row.cost_amount ?? null})`;

    for (const l of preview.labor_lines) {
      if (l.amount === 0) continue;
      await ins({ line_type: 'labor', employee_id: l.employee_id, description: `${l.employee_name} – ${l.tier_label}`, tier: l.tier, quantity: l.hours, unit_rate: l.rate, amount: l.amount, cost_amount: l.cost_amount });
    }
    if (preview.labor_lines.some((l) => l.amount > 0)) {
      await ins({ line_type: 'labor_subtotal', description: 'Labor Subtotal', amount: preview.totals.total_labor, cost_amount: preview.totals.total_labor_cost });
    }

    const byCat = new Map<ExpenseCategory, number>();
    for (const e of preview.expense_lines) {
      if (e.amount === 0) continue;
      await ins({ line_type: 'expense', category: e.category, expense_id: e.expense_id, description: `${e.category_label} – ${e.vendor}${e.description ? ' – ' + e.description : ''}`, amount: e.amount, cost_amount: e.amount });
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
    }
    for (const cat of EXPENSE_CATEGORIES) {
      const sub = byCat.get(cat);
      if (sub && sub > 0) await ins({ line_type: 'expense_subtotal', category: cat, description: `${EXPENSE_CATEGORY_LABELS[cat]} Subtotal`, amount: sub, cost_amount: sub });
    }
    // markup lines per category with non-zero markup; the effective percent
    // (consistent within a category) is persisted in unit_rate for the renderer.
    const markupByCat = new Map<ExpenseCategory, number>();
    const pctByCat = new Map<ExpenseCategory, number>();
    for (const e of preview.expense_lines) {
      markupByCat.set(e.category, (markupByCat.get(e.category) ?? 0) + e.markup_amount);
      pctByCat.set(e.category, e.markup_percent);
    }
    for (const cat of EXPENSE_CATEGORIES) {
      const mk = markupByCat.get(cat);
      if (mk && mk > 0) await ins({ line_type: 'expense_markup', category: cat, description: `${EXPENSE_CATEGORY_LABELS[cat]} Markup`, unit_rate: pctByCat.get(cat) ?? 0, amount: mk, cost_amount: 0 });
    }
    await ins({ line_type: 'grand_total', description: 'Grand Total', amount: preview.totals.grand_total, cost_amount: null });

    const t = preview.totals;
    await tx`UPDATE invoices SET
      status='finalized', finalized_at=now(), sequence_number=${seq}, billed_reference=${billedReference},
      created_by_user_id=COALESCE(created_by_user_id, ${userId}),
      total_labor=${t.total_labor}, total_labor_cost=${t.total_labor_cost},
      total_materials=${t.total_materials}, total_equipment_rent=${t.total_equipment_rent},
      total_truck_rental=${t.total_truck_rental}, total_per_diem=${t.total_per_diem},
      total_travel=${t.total_travel}, total_freight=${t.total_freight}, total_stock_material=${t.total_stock_material},
      total_markup=${t.total_markup}, total_expense_cost=${t.total_expense_cost}, grand_total=${t.grand_total},
      docx_status='pending', pdf_status='pending'
      WHERE id=${invoiceId}`;

    return { billed_reference: billedReference, sequence_number: seq };
  });
}
