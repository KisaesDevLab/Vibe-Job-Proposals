-- Per-customer "overhead" labor uplift. Emits a synthetic labor-style line on
-- every invoice for the customer equal to: amount = total_labor * percent,
-- hours = amount / hourly_rate. Stored snapshot-style on invoices.

ALTER TYPE line_type ADD VALUE IF NOT EXISTS 'overhead';

ALTER TABLE customers
  ADD COLUMN overhead_employee_id uuid REFERENCES employees(id),
  ADD COLUMN overhead_hourly_rate numeric(12,2),
  ADD COLUMN overhead_percent numeric(5,4);

ALTER TABLE invoices
  ADD COLUMN total_overhead numeric(12,2);
