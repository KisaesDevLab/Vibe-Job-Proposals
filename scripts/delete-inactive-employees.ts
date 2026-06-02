// Delete inactive employees + their history rows (level history + cost rates).
// Blocks if any still have time entries / invoice line items / are an
// overhead reference on a customer — those should have been wiped or
// the employee shouldn't be deletable yet.
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const sql = postgres(DATABASE_URL);

async function main() {
  const inactive = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM employees WHERE active = false ORDER BY name`;
  if (inactive.length === 0) {
    console.log('No inactive employees.');
    await sql.end(); return;
  }
  console.log(`Found ${inactive.length} inactive employee(s):`);
  for (const e of inactive) console.log(`  ${e.name}`);

  const ids = inactive.map((e) => e.id);

  // Pre-flight FK check on anything that survives a wipe.
  const conflicts = await sql<{ source: string; n: number }[]>`
    SELECT 'time_entries' AS source, COUNT(*)::int AS n FROM time_entries WHERE employee_id IN ${sql(ids)}
    UNION ALL
    SELECT 'invoice_line_items', COUNT(*)::int FROM invoice_line_items WHERE employee_id IN ${sql(ids)}
    UNION ALL
    SELECT 'customers.overhead_employee_id', COUNT(*)::int FROM customers WHERE overhead_employee_id IN ${sql(ids)}`;
  const blockers = conflicts.filter((c) => c.n > 0);
  if (blockers.length > 0) {
    console.error('BLOCKED — these references still exist:');
    for (const b of blockers) console.error(`  ${b.source}: ${b.n}`);
    await sql.end(); process.exit(2);
  }

  await sql.begin(async (tx) => {
    await tx`DELETE FROM employee_cost_rates WHERE employee_id IN ${sql(ids)}`;
    await tx`DELETE FROM employee_levels      WHERE employee_id IN ${sql(ids)}`;
    await tx`DELETE FROM employees            WHERE id IN ${sql(ids)}`;
  });

  console.log(`Deleted ${inactive.length} employee(s).`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
