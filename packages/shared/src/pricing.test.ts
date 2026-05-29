import { describe, it, expect } from 'vitest';
import {
  resolveMarkup,
  priceTimeEntry,
  priceExpenseEntry,
  computeInvoiceTotals,
  expenseSubtotalOf,
} from './pricing.js';

describe('resolveMarkup precedence', () => {
  it('invoice override wins', () => {
    expect(resolveMarkup({ invoiceOverride: 0.2, customerDefault: 0.15, settingsDefault: 0.1 })).toEqual({
      percent: 0.2,
      source: 'invoice',
    });
  });
  it('customer default next', () => {
    expect(resolveMarkup({ invoiceOverride: null, customerDefault: 0.15, settingsDefault: 0.1 })).toEqual({
      percent: 0.15,
      source: 'customer',
    });
  });
  it('settings default next', () => {
    expect(resolveMarkup({ settingsDefault: 0.1 })).toEqual({ percent: 0.1, source: 'settings' });
  });
  it('zero when nothing set', () => {
    expect(resolveMarkup({})).toEqual({ percent: 0, source: 'zero' });
  });
  it('treats explicit 0 as a real value (customer)', () => {
    expect(resolveMarkup({ customerDefault: 0 })).toEqual({ percent: 0, source: 'customer' });
  });
});

describe('priceTimeEntry', () => {
  const bill = { rate_1x: 100, rate_15x: 150, rate_2x: 200 };
  const cost = { cost_st: 40, cost_ot: 60, cost_dt: 80 };

  it('prices all three tiers', () => {
    const r = priceTimeEntry({ st_hours: 8, ot_hours: 2, dt_hours: 1 }, bill, cost);
    expect(r.tiers).toHaveLength(3);
    expect(r.total).toBe(8 * 100 + 2 * 150 + 1 * 200); // 1300
    expect(r.totalCost).toBe(8 * 40 + 2 * 60 + 1 * 80); // 520
  });
  it('skips zero-hour tiers', () => {
    const r = priceTimeEntry({ st_hours: 8, ot_hours: 0, dt_hours: 0 }, bill, cost);
    expect(r.tiers).toHaveLength(1);
    expect(r.tiers[0].tier).toBe('st');
    expect(r.total).toBe(800);
  });
  it('handles all-zero (no tiers)', () => {
    const r = priceTimeEntry({ st_hours: 0, ot_hours: 0, dt_hours: 0 }, bill, cost);
    expect(r.tiers).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.totalCost).toBe(0);
  });
  it('rounds fractional hours to cents', () => {
    const r = priceTimeEntry({ st_hours: 1.33, ot_hours: 0, dt_hours: 0 }, { rate_1x: 99.99, rate_15x: 0, rate_2x: 0 }, cost);
    expect(r.total).toBe(132.99); // 1.33 * 99.99 = 132.9867 -> 132.99
  });
});

describe('priceExpenseEntry', () => {
  it('applies markup', () => {
    const r = priceExpenseEntry({ category: 'materials', amount: 100 }, 0.15);
    expect(r).toMatchObject({ amount: 100, markup_percent: 0.15, markup_amount: 15, total: 115, cost_amount: 100 });
  });
  it('zero markup passes through', () => {
    const r = priceExpenseEntry({ category: 'freight', amount: 50 }, 0);
    expect(r.markup_amount).toBe(0);
    expect(r.total).toBe(50);
  });
});

describe('computeInvoiceTotals', () => {
  it('empty arrays return zeros', () => {
    const t = computeInvoiceTotals([], []);
    expect(t.grand_total).toBe(0);
    expect(t.total_labor).toBe(0);
    expect(expenseSubtotalOf(t)).toBe(0);
  });

  it('matches a known-good fixture', () => {
    // 8h ST @ $100 = 800 labor (cost 8*40=320)
    const time = [priceTimeEntry({ st_hours: 8, ot_hours: 0, dt_hours: 0 }, { rate_1x: 100, rate_15x: 150, rate_2x: 200 }, { cost_st: 40, cost_ot: 60, cost_dt: 80 })];
    // materials $200 @ 15% markup = 30; equipment $100 @ 10% = 10
    const exp = [
      priceExpenseEntry({ category: 'materials', amount: 200 }, 0.15),
      priceExpenseEntry({ category: 'equipment_rent', amount: 100 }, 0.1),
    ];
    const t = computeInvoiceTotals(time, exp);
    expect(t.total_labor).toBe(800);
    expect(t.total_labor_cost).toBe(320);
    expect(t.total_materials).toBe(200);
    expect(t.total_equipment_rent).toBe(100);
    expect(t.total_markup).toBe(40); // 30 + 10
    expect(t.total_expense_cost).toBe(300);
    expect(expenseSubtotalOf(t)).toBe(300);
    // grand = 800 + 300 + 40
    expect(t.grand_total).toBe(1140);
  });
});
