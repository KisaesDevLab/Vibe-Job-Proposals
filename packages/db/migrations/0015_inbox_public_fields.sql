-- Public (no-login) bill uploads land in the inbox with an optional job-code hint
-- and notes; `source` distinguishes admin uploads from the public upload page.
ALTER TABLE inbox_documents
  ADD COLUMN submitted_job_code text,
  ADD COLUMN notes              text,
  ADD COLUMN source             text NOT NULL DEFAULT 'admin';
