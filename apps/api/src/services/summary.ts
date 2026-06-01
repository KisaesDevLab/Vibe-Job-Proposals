// Summary Invoice service — bundles N finalized child invoices for one
// customer into a single AR-trackable record + customer-facing PDF.
//
// Lifecycle mirrors invoices: draft → finalized → void. Children stay
// immutable; a child invoice can be a member of at most one non-void summary
// at a time (enforced via the partial unique index + trigger in migration
// 0022). Voiding a summary releases its children.
import { sql } from '@darrow/db';
import { writeAudit } from '../audit.js';

export type CategoryTotals = {
  labor: number;
  materials: number;
  equipment_rent: number;
  other: number;
  total: number;
};

export interface MemberRow {
  invoice_id: string;
  billed_reference: string | null;
  job_code: string;
  job_description: string;
  through_date: string;
  totals: CategoryTotals;
  sort_order: number;
}

const OTHER_CATEGORIES = ['truck_rental', 'per_diem', 'travel', 'freight', 'stock_material'] as const;

/** Compute the customer-visible per-category totals for a finalized invoice.
 *  Materials column = pre-markup subtotal + materials markup line; same for
 *  Equipment Rent. "Other" rolls up everything else. The row's total equals
 *  the invoice's grand_total exactly, so summaries reconcile perfectly. */
export async function memberTotals(invoiceId: string): Promise<CategoryTotals> {
  const [inv] = await sql<any[]>`
    SELECT total_labor, total_materials, total_equipment_rent, total_truck_rental,
           total_per_diem, total_travel, total_freight, total_stock_material, grand_total
    FROM invoices WHERE id = ${invoiceId}`;
  if (!inv) throw new Error(`invoice ${invoiceId} not found`);
  const markupByCat = await sql<{ category: string; amt: string }[]>`
    SELECT category, COALESCE(SUM(amount), 0)::numeric(14,2) AS amt
    FROM invoice_line_items
    WHERE invoice_id = ${invoiceId} AND line_type = 'expense_markup'
    GROUP BY category`;
  const mk = new Map(markupByCat.map((r) => [r.category, Number(r.amt)]));

  const labor = Number(inv.total_labor) || 0;
  const materials = (Number(inv.total_materials) || 0) + (mk.get('materials') ?? 0);
  const equip = (Number(inv.total_equipment_rent) || 0) + (mk.get('equipment_rent') ?? 0);
  let other = 0;
  for (const c of OTHER_CATEGORIES) {
    const col = `total_${c}`;
    other += (Number((inv as any)[col]) || 0) + (mk.get(c) ?? 0);
  }
  // Round to 2 decimals to avoid tiny floating residue across categories.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    labor: round2(labor),
    materials: round2(materials),
    equipment_rent: round2(equip),
    other: round2(other),
    total: Number(inv.grand_total) || round2(labor + materials + equip + other),
  };
}

export async function getEligibleInvoices(customerId: string): Promise<any[]> {
  return sql<any[]>`
    SELECT i.id, i.billed_reference, i.through_date::text AS through_date,
           i.grand_total::text AS grand_total, j.code AS job_code, j.description AS job_description
    FROM invoices i
    JOIN jobs j ON j.id = i.job_id
    WHERE j.customer_id = ${customerId}
      AND i.status = 'finalized'
      AND NOT EXISTS (
        SELECT 1 FROM invoice_summary_members m
        WHERE m.invoice_id = i.id AND m.active = true
      )
    ORDER BY i.billed_reference`;
}

/** Auto-suggest a billed_reference. Default: {first member's job.code}.{next seq}
 *  scanning existing summaries for that customer with the same prefix. */
export async function suggestBilledReference(
  customerId: string,
  memberInvoiceIds: string[],
): Promise<string> {
  if (memberInvoiceIds.length === 0) return `SUM-${customerId.slice(0, 4)}-01`;
  const [first] = await sql<{ code: string }[]>`
    SELECT j.code FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.id = ${memberInvoiceIds[0]} LIMIT 1`;
  if (!first) return `SUM-${customerId.slice(0, 4)}-01`;
  const prefix = first.code;
  const rows = await sql<{ billed_reference: string }[]>`
    SELECT billed_reference FROM invoice_summaries
    WHERE customer_id = ${customerId} AND billed_reference LIKE ${prefix + '.%'}`;
  let max = 0;
  for (const r of rows) {
    const m = r.billed_reference.match(/\.(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const next = (max + 1).toString().padStart(2, '0');
  return `${prefix}.${next}`;
}

/** Find the min/max work_date across all bound time_entries for a set of
 *  invoices. Used to default the Start/End fields on the summary. */
export async function memberDateRange(invoiceIds: string[]): Promise<{ start: string | null; end: string | null }> {
  if (invoiceIds.length === 0) return { start: null, end: null };
  const [row] = await sql<{ start: string | null; end: string | null }[]>`
    SELECT MIN(te.work_date)::text AS start, MAX(te.work_date)::text AS end
    FROM time_entries te
    WHERE te.invoice_id IN ${sql(invoiceIds)}`;
  return row ?? { start: null, end: null };
}

export interface CreateDraftInput {
  customer_id: string;
  member_invoice_ids: string[];
  billed_reference?: string;
  description?: string;
  po_number?: string | null;
  location_of_service?: string | null;
  work_start_date?: string | null;
  work_end_date?: string | null;
  userId?: string | null;
}

export async function createDraft(input: CreateDraftInput): Promise<{ id: string }> {
  // Validate all members are finalized invoices of this customer + not bound
  // to another active summary.
  const ids = [...new Set(input.member_invoice_ids)];
  if (ids.length === 0) {
    throw Object.assign(new Error('Summary needs at least one member invoice'), { status: 400, code: 'empty' });
  }
  const members = await sql<any[]>`
    SELECT i.id, i.status, j.customer_id FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.id IN ${sql(ids)}`;
  if (members.length !== ids.length) {
    const found = new Set(members.map((m) => m.id));
    const missing = ids.filter((id) => !found.has(id));
    throw Object.assign(new Error(`Invoice not found: ${missing.join(', ')}`), { status: 400, code: 'bad_member' });
  }
  for (const m of members) {
    if (m.status !== 'finalized') {
      throw Object.assign(new Error(`Invoice ${m.id} is not finalized`), { status: 409, code: 'not_finalized' });
    }
    if (m.customer_id !== input.customer_id) {
      throw Object.assign(new Error(`Invoice ${m.id} belongs to a different customer`), { status: 409, code: 'wrong_customer' });
    }
  }
  const existingActive = await sql<any[]>`
    SELECT invoice_id FROM invoice_summary_members WHERE invoice_id IN ${sql(ids)} AND active = true`;
  if (existingActive.length > 0) {
    throw Object.assign(new Error(`Invoice(s) already in another active summary: ${existingActive.map((r) => r.invoice_id).join(', ')}`), { status: 409, code: 'already_summarized' });
  }

  const billedRef = input.billed_reference?.trim() || (await suggestBilledReference(input.customer_id, ids));
  const range = (input.work_start_date && input.work_end_date)
    ? { start: input.work_start_date, end: input.work_end_date }
    : await memberDateRange(ids);

  const result = await sql.begin(async (tx: any) => {
    const [row] = await tx`
      INSERT INTO invoice_summaries (
        customer_id, billed_reference, description, po_number,
        location_of_service, work_start_date, work_end_date, created_by_user_id
      ) VALUES (
        ${input.customer_id}, ${billedRef}, ${input.description ?? ''},
        ${input.po_number ?? null}, ${input.location_of_service ?? null},
        ${input.work_start_date ?? range.start}, ${input.work_end_date ?? range.end},
        ${input.userId ?? null}
      ) RETURNING id`;
    for (let i = 0; i < ids.length; i++) {
      await tx`INSERT INTO invoice_summary_members (summary_id, invoice_id, sort_order) VALUES (${row.id}, ${ids[i]}, ${i})`;
    }
    return row;
  });
  await writeAudit({ userId: input.userId ?? null, entityType: 'invoice_summary', entityId: result.id, action: 'create', summary: `Created summary ${billedRef} with ${ids.length} members` });
  return { id: result.id };
}

export async function loadSummary(id: string): Promise<any | null> {
  const [row] = await sql<any[]>`
    SELECT s.*, c.name AS customer_name FROM invoice_summaries s
    JOIN customers c ON c.id = s.customer_id WHERE s.id = ${id}`;
  if (!row) return null;
  const members = await sql<any[]>`
    SELECT m.invoice_id, m.sort_order, i.billed_reference, i.through_date::text AS through_date,
           i.grand_total::text AS grand_total, j.code AS job_code, j.description AS job_description
    FROM invoice_summary_members m
    JOIN invoices i ON i.id = m.invoice_id
    JOIN jobs j ON j.id = i.job_id
    WHERE m.summary_id = ${id}
    ORDER BY m.sort_order, j.code`;
  const memberRows: MemberRow[] = [];
  for (const m of members) {
    memberRows.push({
      invoice_id: m.invoice_id,
      billed_reference: m.billed_reference,
      job_code: m.job_code,
      job_description: m.job_description,
      through_date: m.through_date,
      sort_order: m.sort_order,
      totals: await memberTotals(m.invoice_id),
    });
  }
  return { ...row, members: memberRows };
}

export interface UpdateInput {
  billed_reference?: string;
  description?: string;
  po_number?: string | null;
  location_of_service?: string | null;
  work_start_date?: string | null;
  work_end_date?: string | null;
}

export async function updateDraft(id: string, input: UpdateInput): Promise<void> {
  // Empty-string dates from the UI mean "clear" — coerce them to null so the
  // `::date` cast doesn't crash on `""::date`. Same for other optional text
  // fields where `''` should be treated as "no value" rather than the
  // literal empty string.
  const start = input.work_start_date === '' ? null : input.work_start_date;
  const end = input.work_end_date === '' ? null : input.work_end_date;
  await sql`UPDATE invoice_summaries SET
    billed_reference = COALESCE(${input.billed_reference ?? null}, billed_reference),
    description = COALESCE(${input.description ?? null}, description),
    po_number = ${input.po_number === undefined ? sql`po_number` : input.po_number},
    location_of_service = ${input.location_of_service === undefined ? sql`location_of_service` : input.location_of_service},
    work_start_date = ${start === undefined ? sql`work_start_date` : start}::date,
    work_end_date = ${end === undefined ? sql`work_end_date` : end}::date
    WHERE id = ${id} AND status = 'draft'`;
}

export async function addMembers(summaryId: string, invoiceIds: string[], userId?: string | null): Promise<void> {
  const [s] = await sql<any[]>`SELECT customer_id, status FROM invoice_summaries WHERE id = ${summaryId}`;
  if (!s) throw Object.assign(new Error('Summary not found'), { status: 404, code: 'not_found' });
  if (s.status !== 'draft') throw Object.assign(new Error('Summary is not a draft'), { status: 409, code: 'not_draft' });
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return; // nothing to do; avoid the empty IN crash
  const valid = await sql<any[]>`
    SELECT i.id FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.id IN ${sql(ids)} AND i.status = 'finalized' AND j.customer_id = ${s.customer_id}`;
  if (valid.length !== ids.length) {
    throw Object.assign(new Error('One or more invoices are not finalized or belong to a different customer'), { status: 409, code: 'bad_member' });
  }
  const conflicting = await sql<any[]>`
    SELECT invoice_id FROM invoice_summary_members WHERE invoice_id IN ${sql(ids)} AND active = true`;
  if (conflicting.length > 0) {
    throw Object.assign(new Error(`Already summarized: ${conflicting.map((c) => c.invoice_id).join(', ')}`), { status: 409, code: 'already_summarized' });
  }
  const [{ next }] = await sql<{ next: number }[]>`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM invoice_summary_members WHERE summary_id = ${summaryId}`;
  await sql.begin(async (tx: any) => {
    let n = Number(next);
    for (const id of ids) {
      await tx`INSERT INTO invoice_summary_members (summary_id, invoice_id, sort_order) VALUES (${summaryId}, ${id}, ${n})`;
      n++;
    }
  });
  await writeAudit({ userId: userId ?? null, entityType: 'invoice_summary', entityId: summaryId, action: 'update', summary: `Added ${ids.length} member(s)` });
}

export async function removeMembers(summaryId: string, invoiceIds: string[], userId?: string | null): Promise<void> {
  const [s] = await sql<any[]>`SELECT status FROM invoice_summaries WHERE id = ${summaryId}`;
  if (!s) throw Object.assign(new Error('Summary not found'), { status: 404, code: 'not_found' });
  if (s.status !== 'draft') throw Object.assign(new Error('Summary is not a draft'), { status: 409, code: 'not_draft' });
  if (invoiceIds.length === 0) return; // avoid empty IN clause crash
  await sql`DELETE FROM invoice_summary_members WHERE summary_id = ${summaryId} AND invoice_id IN ${sql(invoiceIds)}`;
  await writeAudit({ userId: userId ?? null, entityType: 'invoice_summary', entityId: summaryId, action: 'update', summary: `Removed ${invoiceIds.length} member(s)` });
}

export async function finalizeSummary(id: string, userId?: string | null): Promise<{ billed_reference: string }> {
  return sql.begin(async (tx: any) => {
    const [locked] = await tx`SELECT id, status, billed_reference FROM invoice_summaries WHERE id = ${id} FOR UPDATE`;
    if (!locked) throw Object.assign(new Error('Summary not found'), { status: 404, code: 'not_found' });
    if (locked.status !== 'draft') throw Object.assign(new Error('Summary is not a draft'), { status: 409, code: 'not_draft' });
    const members = await tx<any[]>`SELECT invoice_id FROM invoice_summary_members WHERE summary_id = ${id} ORDER BY sort_order`;
    if (members.length === 0) throw Object.assign(new Error('Summary has no members'), { status: 400, code: 'empty' });
    const totals = { labor: 0, materials: 0, equipment_rent: 0, other: 0, total: 0 };
    for (const m of members) {
      const t = await memberTotals(m.invoice_id);
      totals.labor += t.labor;
      totals.materials += t.materials;
      totals.equipment_rent += t.equipment_rent;
      totals.other += t.other;
      totals.total += t.total;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    await tx`UPDATE invoice_summaries SET
      status = 'finalized', finalized_at = now(),
      total_labor = ${round2(totals.labor)}, total_materials = ${round2(totals.materials)},
      total_equipment_rent = ${round2(totals.equipment_rent)}, total_other = ${round2(totals.other)},
      grand_total = ${round2(totals.total)},
      pdf_status = 'pending', pdf_error = NULL
      WHERE id = ${id}`;
    await writeAudit({ userId: userId ?? null, entityType: 'invoice_summary', entityId: id, action: 'finalize', summary: `Finalized ${locked.billed_reference}` });
    return { billed_reference: locked.billed_reference };
  });
}

export async function voidSummary(id: string, reason: string, userId?: string | null): Promise<void> {
  const [s] = await sql<any[]>`SELECT status, billed_reference FROM invoice_summaries WHERE id = ${id}`;
  if (!s) throw Object.assign(new Error('Summary not found'), { status: 404, code: 'not_found' });
  if (s.status === 'void') throw Object.assign(new Error('Summary already voided'), { status: 409, code: 'already_void' });
  // The AFTER UPDATE OF status trigger flips members.active to false, freeing
  // their children to be summarized again.
  await sql`UPDATE invoice_summaries SET status = 'void', voided_at = now(), void_reason = ${reason}, voided_by_user_id = ${userId ?? null} WHERE id = ${id}`;
  await writeAudit({ userId: userId ?? null, entityType: 'invoice_summary', entityId: id, action: 'void', summary: `Voided ${s.billed_reference}: ${reason}` });
}
