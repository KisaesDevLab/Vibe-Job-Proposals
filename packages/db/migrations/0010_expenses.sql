-- Phase 10: expenses + attachments (invoice_id FK added in 0011).
CREATE TYPE attachment_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE expenses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date          date NOT NULL,
  job_id             uuid NOT NULL REFERENCES jobs(id),
  vendor             text NOT NULL,
  reference          text,
  amount             numeric(12,2) NOT NULL,
  category           expense_category NOT NULL,
  description        text,
  invoice_id         uuid,  -- FK added in 0011
  imported_from_xlsm boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_amount_pos CHECK (amount > 0)
);
CREATE INDEX expenses_job_idx ON expenses (job_id);

CREATE TABLE expense_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id        uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  stored_path       text NOT NULL,
  content_type      text NOT NULL,
  file_size_bytes   bigint NOT NULL,
  status            attachment_status NOT NULL DEFAULT 'pending',
  retry_count       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_attachments_expense_idx ON expense_attachments (expense_id);
