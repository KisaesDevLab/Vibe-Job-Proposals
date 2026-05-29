-- Phase 17: invoice email log.
CREATE TABLE invoice_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  to_address       text NOT NULL,
  cc_addresses     text[] NOT NULL DEFAULT '{}',
  subject          text NOT NULL,
  body             text NOT NULL,
  sent_at          timestamptz,
  sent_by_user_id  uuid REFERENCES users(id),
  included_docx    boolean NOT NULL DEFAULT true,
  included_pdf     boolean NOT NULL DEFAULT true,
  smtp_message_id  text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_emails_invoice_idx ON invoice_emails (invoice_id);
