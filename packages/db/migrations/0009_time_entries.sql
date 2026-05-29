-- Phase 9: time entries (invoice_id FK added in 0011).
CREATE TABLE time_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES employees(id),
  job_id             uuid NOT NULL REFERENCES jobs(id),
  work_date          date NOT NULL,
  st_hours           numeric(6,2) NOT NULL DEFAULT 0,
  ot_hours           numeric(6,2) NOT NULL DEFAULT 0,
  dt_hours           numeric(6,2) NOT NULL DEFAULT 0,
  invoice_id         uuid,  -- FK added in 0011
  imported_from_xlsm boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_uq UNIQUE (employee_id, job_id, work_date),
  CONSTRAINT time_entries_nonneg CHECK (st_hours >= 0 AND ot_hours >= 0 AND dt_hours >= 0),
  CONSTRAINT time_entries_nonzero CHECK (st_hours > 0 OR ot_hours > 0 OR dt_hours > 0)
);
CREATE INDEX time_entries_job_date_idx ON time_entries (job_id, work_date);
CREATE INDEX time_entries_emp_date_idx ON time_entries (employee_id, work_date);
