-- Phase 12/13: invoices, markup overrides, line items, late-binding FKs.
CREATE TYPE invoice_status AS ENUM ('draft', 'finalized', 'void');
CREATE TYPE line_type AS ENUM (
  'labor','labor_subtotal','expense','expense_subtotal','expense_markup','grand_total'
);
CREATE TYPE tier AS ENUM ('st','ot','dt');

CREATE TABLE invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES jobs(id),
  sequence_number     integer,
  billed_reference    text,
  status              invoice_status NOT NULL DEFAULT 'draft',
  through_date        date NOT NULL,
  notes               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid REFERENCES users(id),
  finalized_at        timestamptz,
  voided_at           timestamptz,
  void_reason         text,
  voided_by_user_id   uuid REFERENCES users(id),
  generated_docx_path text,
  generated_pdf_path  text,
  docx_status         attachment_status,
  pdf_status          attachment_status,
  generation_error    text,
  imported_from_xlsm  boolean NOT NULL DEFAULT false,
  -- Phase 12 task 2: snapshot totals (written at finalize)
  total_labor          numeric(12,2),
  total_labor_cost     numeric(12,2),
  total_materials      numeric(12,2),
  total_equipment_rent numeric(12,2),
  total_truck_rental   numeric(12,2),
  total_per_diem       numeric(12,2),
  total_travel         numeric(12,2),
  total_freight        numeric(12,2),
  total_stock_material numeric(12,2),
  total_markup         numeric(12,2),
  total_expense_cost   numeric(12,2),
  grand_total          numeric(12,2)
);
-- Only one draft per job at a time.
CREATE UNIQUE INDEX invoices_one_draft_per_job ON invoices (job_id) WHERE status = 'draft';
CREATE INDEX invoices_job_idx ON invoices (job_id);

CREATE TABLE invoice_markup_overrides (
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  category   expense_category NOT NULL,
  percent    numeric(5,4) NOT NULL,
  PRIMARY KEY (invoice_id, category)
);

CREATE TABLE invoice_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_order  integer NOT NULL,
  line_type   line_type NOT NULL,
  category    expense_category,
  employee_id uuid REFERENCES employees(id),
  expense_id  uuid REFERENCES expenses(id),
  description text NOT NULL,
  tier        tier,
  quantity    numeric(12,2),
  unit_rate   numeric(12,2),
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  cost_amount numeric(12,2)
);
CREATE INDEX invoice_line_items_invoice_idx ON invoice_line_items (invoice_id);

-- Late-binding FKs deferred from Phase 9/10.
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);
ALTER TABLE expenses
  ADD CONSTRAINT expenses_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);
CREATE INDEX time_entries_invoice_idx ON time_entries (invoice_id);
CREATE INDEX expenses_invoice_idx ON expenses (invoice_id);
