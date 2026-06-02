// One-shot: ensure every employee has at least one open-ended
// employee_levels row covering all dates. Without this the pricing engine
// can't resolve "what level did X hold on Y" and labor lines render at $0.
// Idempotent — only inserts where the employee has zero history rows.
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const result = await sql<{ employee_id: string; name: string; level_id: string }[]>`
    SELECT e.id AS employee_id, e.name, e.level_id
    FROM employees e
    WHERE NOT EXISTS (SELECT 1 FROM employee_levels el WHERE el.employee_id = e.id)`;
  console.log(`Backfilling ${result.length} employee(s) missing level history`);
  for (const r of result) {
    await sql`INSERT INTO employee_levels (employee_id, level_id, effective_from) VALUES (${r.employee_id}, ${r.level_id}, '1900-01-01')`;
    console.log(`  ${r.name}`);
  }
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
