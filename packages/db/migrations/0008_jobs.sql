-- Phase 8: jobs.
CREATE TYPE billing_type AS ENUM ('tm', 'quote');

CREATE TABLE jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               citext NOT NULL UNIQUE,
  customer_id        uuid NOT NULL REFERENCES customers(id),
  description        text NOT NULL,
  po_number          text,
  billing_type       billing_type NOT NULL DEFAULT 'tm',
  site_address1      text NOT NULL DEFAULT '',
  site_address2      text NOT NULL DEFAULT '',
  site_city          text NOT NULL DEFAULT '',
  site_state         text NOT NULL DEFAULT '',
  site_zip           text NOT NULL DEFAULT '',
  active             boolean NOT NULL DEFAULT true,
  notes              text,
  imported_from_xlsm boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_customer_idx ON jobs (customer_id);
