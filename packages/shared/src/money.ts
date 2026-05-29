// Money & number helpers. All money stored as numeric(12,2); we treat values as
// JS numbers for arithmetic, rounding to cents at boundaries.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Pre-format a number as "$1,234.56" (used in docx snapshot + UI). */
export function formatMoney(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return USD.format(isFinite(v as number) ? (v as number) : 0);
}

/** Format a decimal percent (0.15) as "15%". */
export function formatPercent(p: number | string | null | undefined): string {
  const v = typeof p === 'string' ? parseFloat(p) : (p ?? 0);
  const pct = (isFinite(v as number) ? (v as number) : 0) * 100;
  // Trim trailing zeros but keep up to 2 decimals.
  return `${parseFloat(pct.toFixed(2))}%`;
}

/** Format an ISO date (YYYY-MM-DD) or Date as MM/DD/YYYY without TZ drift. */
export function formatDateMDY(d: string | Date | null | undefined): string {
  if (!d) return '';
  let y: number, m: number, day: number;
  if (typeof d === 'string') {
    const [yy, mm, dd] = d.slice(0, 10).split('-').map(Number);
    y = yy;
    m = mm;
    day = dd;
  } else {
    y = d.getUTCFullYear();
    m = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  }
  if (!y || !m || !day) return '';
  return `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}/${y}`;
}
