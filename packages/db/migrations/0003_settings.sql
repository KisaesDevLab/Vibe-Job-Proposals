-- Phase 3: settings singleton + markup defaults.
CREATE TYPE expense_category AS ENUM (
  'materials','equipment_rent','truck_rental','per_diem','travel','freight','stock_material'
);

CREATE TABLE settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name        text NOT NULL DEFAULT '',
  address_line1       text NOT NULL DEFAULT '',
  address_line2       text NOT NULL DEFAULT '',
  city                text NOT NULL DEFAULT '',
  state               text NOT NULL DEFAULT '',
  zip                 text NOT NULL DEFAULT '',
  phone               text NOT NULL DEFAULT '',
  email               text NOT NULL DEFAULT '',
  logo_path           text,
  template_docx_path  text,
  -- Phase 17 SMTP fields
  smtp_host           text,
  smtp_port           integer,
  smtp_user           text,
  smtp_password_enc   text,
  smtp_from_address   text,
  smtp_from_name      text,
  smtp_enabled        boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE settings_markup_defaults (
  category expense_category PRIMARY KEY,
  percent  numeric(5,4) NOT NULL DEFAULT 0
);
INSERT INTO settings_markup_defaults (category, percent) VALUES
  ('materials', 0.1500),
  ('equipment_rent', 0.1000),
  ('truck_rental', 0.0000),
  ('per_diem', 0.0000),
  ('travel', 0.0000),
  ('freight', 0.0000),
  ('stock_material', 0.0000)
ON CONFLICT DO NOTHING;
