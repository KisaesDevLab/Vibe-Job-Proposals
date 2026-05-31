-- Phase 5: employees + effective-dated cost rates.
CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  level_id           uuid NOT NULL REFERENCES rate_levels(id),
  active             boolean NOT NULL DEFAULT true,
  hire_date          date,
  notes              text,
  imported_from_xlsm boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_name_uq ON employees (lower(name));

CREATE TABLE employee_cost_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to   date,
  cost_st        numeric(12,2) NOT NULL DEFAULT 0,
  cost_ot        numeric(12,2) NOT NULL DEFAULT 0,
  cost_dt        numeric(12,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_cost_rates_range_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- Prevent overlapping [effective_from, effective_to) windows per employee.
  CONSTRAINT employee_cost_rates_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
