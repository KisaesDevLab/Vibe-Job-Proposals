-- Summary invoices: bundle N finalized child invoices into one
-- customer-facing PDF + AR record. Mirrors the Diamond-style single-line
-- format observed in the operator's legacy spreadsheet.
--
-- Reuses the existing invoice_status enum ('draft' | 'finalized' | 'void')
-- so the lifecycle and admin patterns match the per-invoice flow exactly.

CREATE TABLE invoice_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  billed_reference text NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  description text NOT NULL DEFAULT '',
  po_number text,
  location_of_service text,
  work_start_date date,
  work_end_date date,
  total_labor numeric(14,2),
  total_materials numeric(14,2),
  total_equipment_rent numeric(14,2),
  total_other numeric(14,2),
  grand_total numeric(14,2),
  generated_pdf_path text,
  pdf_status attachment_status,
  pdf_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  finalized_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  voided_by_user_id uuid REFERENCES users(id),
  UNIQUE (customer_id, billed_reference)
);
CREATE INDEX invoice_summaries_customer_idx ON invoice_summaries(customer_id, status);

CREATE TABLE invoice_summary_members (
  summary_id uuid NOT NULL REFERENCES invoice_summaries(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  sort_order integer NOT NULL DEFAULT 0,
  -- Denormalized "this membership is active" flag — flipped by trigger when
  -- the parent summary is voided. A partial unique index enforces that an
  -- invoice belongs to at most ONE non-void summary at any time. Subquery
  -- predicates are not allowed in partial-index WHERE clauses, hence the
  -- denormalization + trigger pattern.
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (summary_id, invoice_id)
);
CREATE UNIQUE INDEX invoice_summary_members_one_active
  ON invoice_summary_members(invoice_id) WHERE active = true;

CREATE OR REPLACE FUNCTION sync_summary_member_active() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'void' AND (OLD.status IS DISTINCT FROM 'void') THEN
    UPDATE invoice_summary_members SET active = false WHERE summary_id = NEW.id;
  ELSIF NEW.status <> 'void' AND OLD.status = 'void' THEN
    -- Voided summaries should not be un-voided (Phase 16 invariant); defensive.
    UPDATE invoice_summary_members SET active = true WHERE summary_id = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_summaries_status_to_members
  AFTER UPDATE OF status ON invoice_summaries
  FOR EACH ROW EXECUTE FUNCTION sync_summary_member_active();
