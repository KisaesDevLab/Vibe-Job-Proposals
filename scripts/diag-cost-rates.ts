// Print cost rate history for a given employee name.
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
const NAME = process.argv[2] ?? 'Esai Martinez';
const rows = await sql<any[]>`
  SELECT cr.id, cr.effective_from::text AS effective_from, COALESCE(cr.effective_to::text,'open') AS effective_to,
         cr.cost_st, cr.cost_ot, cr.cost_dt, cr.created_at::text
  FROM employees e
  JOIN employee_cost_rates cr ON cr.employee_id = e.id
  WHERE e.name = ${NAME}
  ORDER BY cr.effective_from`;
console.log(`Cost rate history for ${NAME}:`);
console.table(rows);
await sql.end();
