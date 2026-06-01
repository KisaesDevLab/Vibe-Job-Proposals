-- Backfill: lower the earliest employee_levels row per employee to 1900-01-01
-- so that time_entries dated before the employee's seeded effective_from
-- (commonly hire_date for legacy imports) still resolve via getLevelAt.
-- Only touches the *first* row per employee — does not affect closed history
-- segments produced by later promotions/demotions.
WITH first_row AS (
  SELECT DISTINCT ON (employee_id) id
  FROM employee_levels
  ORDER BY employee_id, effective_from ASC
)
UPDATE employee_levels el
SET effective_from = DATE '1900-01-01'
FROM first_row fr
WHERE el.id = fr.id AND el.effective_from > DATE '1900-01-01';
