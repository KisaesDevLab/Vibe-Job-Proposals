// Diagnose why time entries aren't pricing. Print:
//  - employees count + count missing employee_levels history
//  - rate schedules per customer + line count + date range
//  - sample time entries with the resolved schedule/level/rate per row
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const empSummary = await sql<any[]>`
    SELECT
      (SELECT COUNT(*) FROM employees WHERE active) AS active_employees,
      (SELECT COUNT(*) FROM employees e
        WHERE e.active AND NOT EXISTS (
          SELECT 1 FROM employee_levels el WHERE el.employee_id = e.id
        )) AS active_employees_missing_level_history`;
  console.log('Employees:', empSummary[0]);

  const customerRates = await sql<any[]>`
    SELECT c.name,
      (SELECT COUNT(*) FROM rate_schedules rs WHERE rs.customer_id = c.id) AS schedule_count,
      (SELECT COUNT(*) FROM rate_schedule_lines rsl
        JOIN rate_schedules rs ON rs.id = rsl.schedule_id
        WHERE rs.customer_id = c.id) AS line_count
    FROM customers c WHERE c.active ORDER BY c.name`;
  console.log('\nCustomers / schedules / lines:');
  console.table(customerRates);

  const teSummary = await sql<any[]>`
    SELECT COUNT(*)::int AS total,
      MIN(work_date)::text AS earliest,
      MAX(work_date)::text AS latest
    FROM time_entries`;
  console.log('\nTime entries:', teSummary[0]);

  // Sample 10 time entries with their resolution
  const sample = await sql<any[]>`
    SELECT te.work_date::text, e.name AS employee, j.code AS job, c.name AS customer,
      el.level_id, rl.name AS level_name,
      rs.id AS schedule_id, rs.effective_from::text AS sched_from, COALESCE(rs.effective_to::text, 'open') AS sched_to,
      rsl.rate_1x, rsl.rate_15x, rsl.rate_2x,
      te.st_hours, te.ot_hours, te.dt_hours
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN jobs j ON j.id = te.job_id
    JOIN customers c ON c.id = j.customer_id
    LEFT JOIN employee_levels el ON el.employee_id = te.employee_id
      AND daterange(el.effective_from, COALESCE(el.effective_to, 'infinity'::date), '[)') @> te.work_date
    LEFT JOIN rate_levels rl ON rl.id = el.level_id
    LEFT JOIN rate_schedules rs ON rs.customer_id = j.customer_id
      AND daterange(rs.effective_from, COALESCE(rs.effective_to, 'infinity'::date), '[)') @> te.work_date
    LEFT JOIN rate_schedule_lines rsl ON rsl.schedule_id = rs.id AND rsl.level_id = el.level_id
    ORDER BY te.work_date DESC LIMIT 10`;
  console.log('\nSample 10 time entries (most recent):');
  console.table(sample);

  // How many time entries have NO resolved schedule line?
  const unresolved = await sql<any[]>`
    SELECT
      COUNT(*) FILTER (WHERE el.level_id IS NULL) AS no_level_history,
      COUNT(*) FILTER (WHERE rs.id IS NULL) AS no_schedule_covering_date,
      COUNT(*) FILTER (WHERE rsl.id IS NULL AND el.level_id IS NOT NULL AND rs.id IS NOT NULL) AS no_line_for_level,
      COUNT(*) AS total
    FROM time_entries te
    JOIN jobs j ON j.id = te.job_id
    LEFT JOIN employee_levels el ON el.employee_id = te.employee_id
      AND daterange(el.effective_from, COALESCE(el.effective_to, 'infinity'::date), '[)') @> te.work_date
    LEFT JOIN rate_schedules rs ON rs.customer_id = j.customer_id
      AND daterange(rs.effective_from, COALESCE(rs.effective_to, 'infinity'::date), '[)') @> te.work_date
    LEFT JOIN rate_schedule_lines rsl ON rsl.schedule_id = rs.id AND rsl.level_id = el.level_id`;
  console.log('\nUnresolved breakdown:', unresolved[0]);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
