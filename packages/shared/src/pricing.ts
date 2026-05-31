/**
 * Pure pricing engine — Phase 11.
 *
 * Every function here is pure (no DB, no IO) so it is fully unit-testable in
 * isolation. DB-backed lookups (getRateAt / getCostRateAt / getMarkupPercent)
 * live in the API service layer and feed *resolved* values into these helpers.
 *
 * Errors are returned, not thrown — the caller decides whether to block finalize.
 */
import { round2 } from './money.js';
import type { ExpenseCategory, Tier } from './categories.js';
import { EXPENSE_CATEGORIES, TIERS } from './categories.js';

export type MarkupSource = 'invoice' | 'customer' | 'settings' | 'zero';

export interface BillRates {
  rate_1x: number;
  rate_15x: number;
  rate_2x: number;
}
export interface CostRates {
  cost_st: number;
  cost_ot: number;
  cost_dt: number;
}

export interface TimeEntryInput {
  st_hours: number;
  ot_hours: number;
  dt_hours: number;
}

export interface TierResult {
  tier: Tier;
  hours: number;
  rate: number;
  amount: number;
  cost: number;
}

export interface PricedTimeEntry {
  tiers: TierResult[]; // only non-zero-hour tiers
  total: number;
  totalCost: number;
}

export interface PricedExpense {
  category: ExpenseCategory;
  amount: number; // raw expense amount (= cost to firm)
  markup_percent: number;
  markup_amount: number;
  total: number;
  cost_amount: number;
}

/**
 * Markup precedence: invoice override → customer default → settings default → zero.
 * Pass `null`/`undefined` for any level that is unset.
 */
export function resolveMarkup(opts: {
  invoiceOverride?: number | null;
  customerDefault?: number | null;
  settingsDefault?: number | null;
}): { percent: number; source: MarkupSource } {
  if (opts.invoiceOverride != null) return { percent: opts.invoiceOverride, source: 'invoice' };
  if (opts.customerDefault != null) return { percent: opts.customerDefault, source: 'customer' };
  if (opts.settingsDefault != null) return { percent: opts.settingsDefault, source: 'settings' };
  return { percent: 0, source: 'zero' };
}

const TIER_RATE: Record<Tier, keyof BillRates> = {
  st: 'rate_1x',
  ot: 'rate_15x',
  dt: 'rate_2x',
};
const TIER_HOURS: Record<Tier, keyof TimeEntryInput> = {
  st: 'st_hours',
  ot: 'ot_hours',
  dt: 'dt_hours',
};
const TIER_COST: Record<Tier, keyof CostRates> = {
  st: 'cost_st',
  ot: 'cost_ot',
  dt: 'cost_dt',
};

export function priceTimeEntry(
  entry: TimeEntryInput,
  bill: BillRates,
  cost: CostRates,
): PricedTimeEntry {
  const tiers: TierResult[] = [];
  let total = 0;
  let totalCost = 0;
  for (const tier of TIERS) {
    const hours = Number(entry[TIER_HOURS[tier]] ?? 0);
    if (hours <= 0) continue;
    const rate = Number(bill[TIER_RATE[tier]] ?? 0);
    const costRate = Number(cost[TIER_COST[tier]] ?? 0);
    const amount = round2(hours * rate);
    const lineCost = round2(hours * costRate);
    tiers.push({ tier, hours, rate, amount, cost: lineCost });
    total = round2(total + amount);
    totalCost = round2(totalCost + lineCost);
  }
  return { tiers, total, totalCost };
}

export function priceExpenseEntry(
  expense: { category: ExpenseCategory; amount: number },
  markupPercent: number,
): PricedExpense {
  const amount = round2(Number(expense.amount ?? 0));
  const pct = Number(markupPercent ?? 0);
  const markup_amount = round2(amount * pct);
  return {
    category: expense.category,
    amount,
    markup_percent: pct,
    markup_amount,
    total: round2(amount + markup_amount),
    cost_amount: amount, // an expense's cost to the firm = its raw amount
  };
}

export interface InvoiceTotals {
  total_labor: number;
  total_labor_cost: number;
  total_materials: number;
  total_equipment_rent: number;
  total_truck_rental: number;
  total_per_diem: number;
  total_travel: number;
  total_freight: number;
  total_stock_material: number;
  total_markup: number;
  total_expense_cost: number;
  grand_total: number;
}

const CATEGORY_TOTAL_KEY: Record<ExpenseCategory, keyof InvoiceTotals> = {
  materials: 'total_materials',
  equipment_rent: 'total_equipment_rent',
  truck_rental: 'total_truck_rental',
  per_diem: 'total_per_diem',
  travel: 'total_travel',
  freight: 'total_freight',
  stock_material: 'total_stock_material',
};

/**
 * Aggregate priced time + expense lines into the canonical snapshot totals.
 * Category subtotals hold the *pre-markup* expense amounts; markup is summed
 * separately into total_markup; grand_total = labor + expenses + markup.
 */
export function computeInvoiceTotals(
  timeEntries: PricedTimeEntry[],
  expenses: PricedExpense[],
): InvoiceTotals {
  const totals: InvoiceTotals = {
    total_labor: 0,
    total_labor_cost: 0,
    total_materials: 0,
    total_equipment_rent: 0,
    total_truck_rental: 0,
    total_per_diem: 0,
    total_travel: 0,
    total_freight: 0,
    total_stock_material: 0,
    total_markup: 0,
    total_expense_cost: 0,
    grand_total: 0,
  };

  for (const t of timeEntries) {
    totals.total_labor = round2(totals.total_labor + t.total);
    totals.total_labor_cost = round2(totals.total_labor_cost + t.totalCost);
  }

  let expenseSubtotal = 0;
  for (const e of expenses) {
    const key = CATEGORY_TOTAL_KEY[e.category];
    totals[key] = round2((totals[key] as number) + e.amount);
    totals.total_markup = round2(totals.total_markup + e.markup_amount);
    totals.total_expense_cost = round2(totals.total_expense_cost + e.cost_amount);
    expenseSubtotal = round2(expenseSubtotal + e.amount);
  }

  totals.grand_total = round2(totals.total_labor + expenseSubtotal + totals.total_markup);
  return totals;
}

/** Sum of per-category expense subtotals from a totals object. */
export function expenseSubtotalOf(totals: InvoiceTotals): number {
  return round2(
    EXPENSE_CATEGORIES.reduce((acc, c) => acc + (totals[CATEGORY_TOTAL_KEY[c]] as number), 0),
  );
}
