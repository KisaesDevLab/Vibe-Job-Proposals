-- Snapshot the source time_entry on each labor line so the package PDF can
-- resolve the per-day rate after a mid-invoice level promotion (where one
-- (employee, tier) maps to different unit_rates across dates). Existing
-- finalized snapshots remain valid — time_entry_id is nullable and the
-- renderer falls back to the per-(employee, tier) rate map when null.
ALTER TABLE invoice_line_items
  ADD COLUMN time_entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL;
CREATE INDEX invoice_line_items_time_entry_idx
  ON invoice_line_items(time_entry_id)
  WHERE time_entry_id IS NOT NULL;
