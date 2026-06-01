// Builds the docx placeholder data object from the persisted snapshot
// (invoices.total_* + invoice_line_items) — never recomputed from rate tables.
import { sql } from '@darrow/db';
import {
  formatMoney,
  formatDateMDY,
  formatPercent,
  EXPENSE_CATEGORY_LABELS,
  TIER_LABELS,
  type ExpenseCategory,
} from '@darrow/shared';

export async function buildInvoiceData(invoiceId: string): Promise<Record<string, any>> {
  const [inv] = await sql<any[]>`
    SELECT i.*, j.code AS job_code, j.description AS job_description, j.po_number,
           j.billing_type, j.site_address1, j.site_address2, j.site_city, j.site_state, j.site_zip,
           c.name AS customer_name, c.bill_to_address1, c.bill_to_address2, c.bill_to_city,
           c.bill_to_state, c.bill_to_zip
    FROM invoices i JOIN jobs j ON j.id=i.job_id JOIN customers c ON c.id=j.customer_id
    WHERE i.id=${invoiceId}`;
  if (!inv) throw new Error(`invoice ${invoiceId} not found`);
  const [settings] = await sql<any[]>`SELECT * FROM settings WHERE id=1`;
  const lines = await sql<any[]>`SELECT * FROM invoice_line_items WHERE invoice_id=${invoiceId} ORDER BY line_order`;

  // Resolve real names/vendors from the stored ids rather than parsing the
  // formatted description (which breaks if a label contains the separator).
  const empIds = [...new Set(lines.filter((l) => l.employee_id).map((l) => l.employee_id))];
  const expIds = [...new Set(lines.filter((l) => l.expense_id).map((l) => l.expense_id))];
  const empRows = empIds.length ? await sql<any[]>`SELECT id, name FROM employees WHERE id IN ${sql(empIds)}` : [];
  const expRows = expIds.length ? await sql<any[]>`SELECT id, vendor, description FROM expenses WHERE id IN ${sql(expIds)}` : [];
  const empName = new Map(empRows.map((e) => [e.id, e.name]));
  const expById = new Map(expRows.map((e) => [e.id, e]));

  const laborLines = lines
    .filter((l) => l.line_type === 'labor' || l.line_type === 'overhead')
    .map((l) => ({
      employee_name: empName.get(l.employee_id) ?? l.description.split(' – ')[0],
      tier_label: TIER_LABELS[(l.tier ?? 'st') as keyof typeof TIER_LABELS],
      hours: Number(l.quantity),
      rate: formatMoney(l.unit_rate),
      amount: formatMoney(l.amount),
      // Renderer keys aggregation on this so a worker who is also the
      // overhead employee on the same invoice doesn't merge into one row.
      is_overhead: l.line_type === 'overhead',
    }));

  const expenseFlat = lines
    .filter((l) => l.line_type === 'expense')
    .map((l) => {
      const e = expById.get(l.expense_id);
      return {
        category_label: EXPENSE_CATEGORY_LABELS[l.category as ExpenseCategory] ?? l.category,
        vendor: e?.vendor ?? '',
        description: e?.description ?? '',
        amount: formatMoney(l.amount),
      };
    });

  const markupLines = lines
    .filter((l) => l.line_type === 'expense_markup')
    .map((l) => ({
      category_label: EXPENSE_CATEGORY_LABELS[l.category as ExpenseCategory] ?? l.category,
      percent_label: formatPercent(l.unit_rate ?? 0),
      amount: formatMoney(l.amount),
    }));

  const byCat: Record<string, any[]> = {};
  for (const e of expenseFlat) (byCat[e.category_label] ??= []).push(e);

  const addr = (parts: (string | null)[]) => parts.filter((p) => p && p.trim()).join('\n');

  const totalsRaw = {
    labor: inv.total_labor,
    materials: inv.total_materials,
    equipment_rent: inv.total_equipment_rent,
    truck_rental: inv.total_truck_rental,
    per_diem: inv.total_per_diem,
    travel: inv.total_travel,
    freight: inv.total_freight,
    stock_material: inv.total_stock_material,
    markup: inv.total_markup,
    grand_total: inv.grand_total,
  };
  const totals: Record<string, string> = {};
  for (const [k, v] of Object.entries(totalsRaw)) totals[k] = formatMoney(v as any);

  return {
    company: {
      name: settings?.company_name ?? '',
      address: addr([settings?.address_line1, settings?.address_line2, `${settings?.city ?? ''}, ${settings?.state ?? ''} ${settings?.zip ?? ''}`]),
      phone: settings?.phone ?? '',
      email: settings?.email ?? '',
    },
    customer: {
      name: inv.customer_name,
      bill_to_address: addr([inv.bill_to_address1, inv.bill_to_address2, `${inv.bill_to_city ?? ''}, ${inv.bill_to_state ?? ''} ${inv.bill_to_zip ?? ''}`]),
    },
    job: {
      code: inv.job_code,
      description: inv.job_description,
      po_number: inv.po_number ?? '',
      billing_type_label: inv.billing_type === 'quote' ? 'Quote' : 'Time & Materials',
      site_address: addr([inv.site_address1, inv.site_address2, `${inv.site_city ?? ''}, ${inv.site_state ?? ''} ${inv.site_zip ?? ''}`]),
    },
    invoice: {
      number: inv.billed_reference ?? '',
      date: formatDateMDY(inv.finalized_at ? new Date(inv.finalized_at).toISOString().slice(0, 10) : null),
      through_date: formatDateMDY(inv.through_date),
      notes: inv.notes ?? '',
    },
    totals,
    labor_lines: laborLines,
    expense_lines_flat: expenseFlat,
    expense_lines_by_category: byCat,
    markup_lines: markupLines,
    has_labor: laborLines.length > 0,
    has_materials: Number(inv.total_materials) > 0,
    has_equipment_rent: Number(inv.total_equipment_rent) > 0,
    has_truck_rental: Number(inv.total_truck_rental) > 0,
    has_per_diem: Number(inv.total_per_diem) > 0,
    has_travel: Number(inv.total_travel) > 0,
    has_freight: Number(inv.total_freight) > 0,
    has_stock_material: Number(inv.total_stock_material) > 0,
    has_markup: Number(inv.total_markup) > 0,
    _formatPercent: formatPercent,
  };
}
