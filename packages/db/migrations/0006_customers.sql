-- Phase 6: customers + markup defaults.
CREATE TABLE customers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL UNIQUE,
  bill_to_address1         text NOT NULL DEFAULT '',
  bill_to_address2         text NOT NULL DEFAULT '',
  bill_to_city             text NOT NULL DEFAULT '',
  bill_to_state            text NOT NULL DEFAULT '',
  bill_to_zip              text NOT NULL DEFAULT '',
  contact_name             text NOT NULL DEFAULT '',
  contact_email            text NOT NULL DEFAULT '',
  contact_phone            text NOT NULL DEFAULT '',
  active                   boolean NOT NULL DEFAULT true,
  notes                    text,
  default_rate_schedule_id uuid,  -- FK added in 0007 after rate_schedules exists
  imported_from_xlsm       boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_markup_defaults (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category    expense_category NOT NULL,
  percent     numeric(5,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, category)
);
