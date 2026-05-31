// Pure parsing helpers for the historical XLSM importer (Phase 18).

/** Companies code → customer-name map (CLAUDE.md §5 / Phase 18 step 3). */
export const COMPANY_CODE_NAMES: Record<string, string> = {
  J: 'Jasper Products',
  B: 'Bagcraft',
  NB: 'Nutra Blend',
  SC: 'Sugar Creek',
  D: 'Diamond Pet Foods',
  G: 'Graham Packaging',
  EP: 'Eagle Picher',
  DS: 'Darlington',
  // Note: Modine has no job-code letter in the legacy Companies sheet (the 8 codes
  // above are the only ones used); it remains a seeded customer reachable by name.
};

export interface ParsedJobCode {
  raw: string;
  year: number | null;
  customer_code: string;
  base_code: string;
  billed_suffix: string | null;
}

/**
 * Parse `D{YY}{CUST}{SEQ}[.{NN}]`.
 * - strip leading constant `D` (Darrow)
 * - next 2 digits = 2-digit year
 * - alphabetic run = customer code (longest match against the provided code set,
 *   so `NB` beats `N`)
 * - trailing digits = job sequence; an optional `.NN` suffix is the historical
 *   billed reference and is NOT part of the job code.
 */
export function parseJobCode(code: string, codes: string[] = Object.keys(COMPANY_CODE_NAMES)): ParsedJobCode {
  const raw = String(code).trim();
  const [main, suffix] = raw.split('.');
  const m = /^D(\d{2})([A-Za-z]+)(\d+)$/.exec(main);
  if (!m) {
    return { raw, year: null, customer_code: '', base_code: main, billed_suffix: suffix ?? null };
  }
  const year = parseInt(m[1], 10);
  const alpha = m[2].toUpperCase();
  const seq = m[3];
  // longest map key that is a prefix of the alpha run; fall back to whole run.
  let custCode = alpha;
  const candidates = codes.filter((c) => alpha.startsWith(c.toUpperCase())).sort((a, b) => b.length - a.length);
  if (candidates.length > 0) custCode = candidates[0].toUpperCase();
  const base_code = `D${m[1]}${alpha}${seq}`;
  return { raw, year, customer_code: custCode, base_code, billed_suffix: suffix ?? null };
}

/**
 * Convert an Excel cell value to an ISO date string (YYYY-MM-DD), date-only,
 * no TZ shift. Accepts a JS Date (from exceljs) or a raw 1900-system serial.
 */
export function excelToDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    // Excel 1900 system epoch is 1899-12-30 (accounts for the 1900 leap bug).
    const ms = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Map a level label ("3", "Journeyman", "Foreman") to a rate-level name. */
export function levelNameFromLabel(label: unknown): string {
  const s = String(label ?? '').trim();
  if (/^\d+$/.test(s)) return `Apprentice Yr ${s}`;
  if (/journeyman/i.test(s)) return 'Journeyman';
  if (/foreman/i.test(s)) return 'Foreman';
  return s || 'Journeyman';
}

/** Map an AW Account string to an expense category. */
export function categoryFromAccount(account: unknown): { category: string; fallback: boolean } {
  const s = String(account ?? '').toLowerCase();
  if (s.includes('5040') || s.includes('material')) return { category: 'materials', fallback: false };
  if (s.includes('6250') || s.includes('equipment')) return { category: 'equipment_rent', fallback: false };
  if (s.includes('freight')) return { category: 'freight', fallback: false };
  return { category: 'materials', fallback: true };
}
