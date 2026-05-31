-- Per-user SMTP sender settings (so invoice emails can come directly from the
-- sending user). Either full per-user credentials OR just a From address that
-- rides the company relay; falls back to the global settings SMTP.
ALTER TABLE users
  ADD COLUMN smtp_host          text,
  ADD COLUMN smtp_port          integer,
  ADD COLUMN smtp_user          text,
  ADD COLUMN smtp_password_enc  text,
  ADD COLUMN smtp_from_address  text,
  ADD COLUMN smtp_from_name     text,
  ADD COLUMN smtp_enabled       boolean NOT NULL DEFAULT false;
