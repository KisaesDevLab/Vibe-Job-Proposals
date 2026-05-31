-- Phase 7: rate schedules + lines.
CREATE TABLE rate_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  notes          text,
  imported_from_xlsm boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_schedules_range_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT rate_schedules_no_overlap EXCLUDE USING gist (
    customer_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE TABLE rate_schedule_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES rate_schedules(id) ON DELETE CASCADE,
  level_id    uuid NOT NULL REFERENCES rate_levels(id),
  rate_1x     numeric(12,2) NOT NULL DEFAULT 0,
  rate_15x    numeric(12,2) NOT NULL DEFAULT 0,
  rate_2x     numeric(12,2) NOT NULL DEFAULT 0,
  UNIQUE (schedule_id, level_id)
);

ALTER TABLE customers
  ADD CONSTRAINT customers_default_schedule_fk
  FOREIGN KEY (default_rate_schedule_id) REFERENCES rate_schedules(id);
