// DB-backed lookups feeding the pure pricing engine. Errors are returned,
// not thrown (Phase 11).
import { sql } from '@darrow/db';
import type { ExpenseCategory } from '@darrow/shared';

export interface RateResult {
  rate_1x: number;
  rate_15x: number;
  rate_2x: number;
  schedule_id: string;
  schedule_name: string;
}
export type RateLookup = RateResult | { error: 'no_schedule' | 'no_level_line'; detail: string };

export async function getRateAt(
  customerId: string,
  levelId: string,
  workDate: string,
): Promise<RateLookup> {
  const schedules = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM rate_schedules
    WHERE customer_id = ${customerId}
      AND daterange(effective_from, effective_to, '[)') @> ${workDate}::date
    ORDER BY effective_from DESC
    LIMIT 1`;
  if (schedules.length === 0) {
    return { error: 'no_schedule', detail: `No rate schedule for customer covering ${workDate}` };
  }
  const sched = schedules[0];
  const lines = await sql<{ rate_1x: string; rate_15x: string; rate_2x: string }[]>`
    SELECT rate_1x, rate_15x, rate_2x FROM rate_schedule_lines
    WHERE schedule_id = ${sched.id} AND level_id = ${levelId} LIMIT 1`;
  if (lines.length === 0) {
    return { error: 'no_level_line', detail: `Schedule "${sched.name}" has no line for this rate level` };
  }
  return {
    rate_1x: Number(lines[0].rate_1x),
    rate_15x: Number(lines[0].rate_15x),
    rate_2x: Number(lines[0].rate_2x),
    schedule_id: sched.id,
    schedule_name: sched.name,
  };
}

export interface CostResult {
  cost_st: number;
  cost_ot: number;
  cost_dt: number;
  rate_id: string;
}
export type CostLookup = CostResult | { error: 'no_cost_rate'; detail: string };

export async function getCostRateAt(employeeId: string, workDate: string): Promise<CostLookup> {
  const rows = await sql<{ id: string; cost_st: string; cost_ot: string; cost_dt: string }[]>`
    SELECT id, cost_st, cost_ot, cost_dt FROM employee_cost_rates
    WHERE employee_id = ${employeeId}
      AND daterange(effective_from, effective_to, '[)') @> ${workDate}::date
    ORDER BY effective_from DESC LIMIT 1`;
  if (rows.length === 0) {
    return { error: 'no_cost_rate', detail: `No cost rate for employee covering ${workDate}` };
  }
  return {
    cost_st: Number(rows[0].cost_st),
    cost_ot: Number(rows[0].cost_ot),
    cost_dt: Number(rows[0].cost_dt),
    rate_id: rows[0].id,
  };
}

export type MarkupSourceTag = 'invoice' | 'customer' | 'settings' | 'zero';

export async function getMarkupPercent(
  customerId: string,
  category: ExpenseCategory,
  invoiceOverridePct?: number | null,
): Promise<{ percent: number; source: MarkupSourceTag }> {
  if (invoiceOverridePct != null) return { percent: invoiceOverridePct, source: 'invoice' };
  const cust = await sql<{ percent: string }[]>`
    SELECT percent FROM customer_markup_defaults
    WHERE customer_id = ${customerId} AND category = ${category} LIMIT 1`;
  if (cust.length > 0) return { percent: Number(cust[0].percent), source: 'customer' };
  const set = await sql<{ percent: string }[]>`
    SELECT percent FROM settings_markup_defaults WHERE category = ${category} LIMIT 1`;
  if (set.length > 0) return { percent: Number(set[0].percent), source: 'settings' };
  return { percent: 0, source: 'zero' };
}
