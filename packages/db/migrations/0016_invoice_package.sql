-- Multi-page invoice package PDF (proposal + employee hours + weekly grid + materials list + attachments)
ALTER TABLE invoices
  ADD COLUMN generated_package_path text,
  ADD COLUMN package_status attachment_status,
  ADD COLUMN package_error text;
