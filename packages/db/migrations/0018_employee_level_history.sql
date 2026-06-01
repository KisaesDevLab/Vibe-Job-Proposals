-- Effective-dated history of each employee's rate level. Mirrors the
-- employee_cost_rates pattern. Pricing reads this table to bill past hours at
-- the level the employee held when those hours were worked, so a promotion
-- doesn't retroactively re-rate finalized or unbilled labor.
CREATE TABLE employee_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  level_id uuid NOT NULL REFERENCES rate_levels(id),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  )
);
CREATE INDEX employee_levels_employee_idx ON employee_levels (employee_id, effective_from DESC);

-- Seed one open-ended row per existing employee floored at 1900-01-01 so
-- getLevelAt covers every existing time_entry — including legacy imports that
-- predate the employee's recorded hire_date. The denormalized
-- employees.level_id stays in sync as the "current" cache.
INSERT INTO employee_levels (employee_id, level_id, effective_from, effective_to)
SELECT id, level_id, DATE '1900-01-01', NULL
FROM employees;
