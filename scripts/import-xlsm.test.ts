// Integration test for the Phase 18 importer against the synthetic fixture.
// Requires DATABASE_URL (skipped otherwise so the unit-only green gate still passes).
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d('xlsm importer (integration)', () => {
  let runImport: any;
  let makeFixture: any;
  let sql: any;
  const fixture = join(process.cwd(), 'packages/db/test/fixtures/Time_Allocation_Tracking.xlsx');

  beforeAll(async () => {
    ({ runImport } = await import('./import-xlsm.js'));
    ({ makeFixture } = await import('../packages/db/test/fixtures/make-fixture.js'));
    ({ sql } = await import('@darrow/db'));
    const { runMigrations } = await import('@darrow/db');
    await runMigrations();
    if (!existsSync(fixture)) await makeFixture(fixture);
  });

  it('imports the fixture and is idempotent', async () => {
    await runImport(fixture);
    const inv1 = Number((await sql`SELECT count(*)::int n FROM invoices WHERE imported_from_xlsm`)[0].n);
    const jobs1 = Number((await sql`SELECT count(*)::int n FROM jobs WHERE imported_from_xlsm`)[0].n);

    // re-run: no new invoices/jobs (idempotent on natural keys)
    await runImport(fixture);
    const inv2 = Number((await sql`SELECT count(*)::int n FROM invoices WHERE imported_from_xlsm`)[0].n);
    const jobs2 = Number((await sql`SELECT count(*)::int n FROM jobs WHERE imported_from_xlsm`)[0].n);
    expect(inv2).toBe(inv1);
    expect(jobs2).toBe(jobs1);
    expect(jobs1).toBe(5);
  });

  it('preserves verbatim billed_reference and creates a placeholder for unmapped codes', async () => {
    const refs = (await sql`SELECT billed_reference FROM invoices WHERE imported_from_xlsm ORDER BY billed_reference`).map((r: any) => r.billed_reference);
    expect(refs).toContain('D24NB001.01');
    expect(refs).toContain('D24B001.01');
    const placeholder = await sql`SELECT id FROM customers WHERE name='Unknown (MF)'`;
    expect(placeholder.length).toBe(1);
  });

  it("a historical invoice's grand_total equals the sum of its snapshot value lines", async () => {
    const [inv] = await sql`SELECT id, grand_total FROM invoices WHERE billed_reference='D24NB001.01'`;
    const [{ sum }] = await sql`
      SELECT COALESCE(SUM(amount),0) AS sum FROM invoice_line_items
      WHERE invoice_id=${inv.id} AND line_type IN ('labor','expense','expense_markup')`;
    expect(Number(sum)).toBeCloseTo(Number(inv.grand_total), 2);
    // Time Recap binding: Brett's 16 ST + 2 OT on Nutra Blend should be present
    const labor = await sql`SELECT count(*)::int n FROM invoice_line_items WHERE invoice_id=${inv.id} AND line_type='labor'`;
    expect(Number(labor[0].n)).toBeGreaterThan(0);
  });
});
