-- Bill processing inbox: unassigned documents uploaded before an expense exists.
-- Reuses the attachment_status enum (pending|ready|failed). Rows are removed once
-- a document is processed into an expense.
CREATE TABLE inbox_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename   text NOT NULL,
  stored_path         text NOT NULL,
  content_type        text NOT NULL,
  file_size_bytes     bigint NOT NULL,
  status              attachment_status NOT NULL DEFAULT 'pending',
  retry_count         integer NOT NULL DEFAULT 0,
  uploaded_by_user_id uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbox_documents_status_idx ON inbox_documents (status, created_at);
