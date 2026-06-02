// One-shot wipe so the operator can re-import from xlsx. Deletes customers,
// jobs, time entries, expenses (+ attachments on disk), invoices, summaries,
// inbox documents. Keeps employees, rate levels, settings, users, audit log.
import postgres from 'postgres';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
const STORAGE_ROOT = process.env.STORAGE_ROOT;
if (!DATABASE_URL || !STORAGE_ROOT) {
  console.error('DATABASE_URL and STORAGE_ROOT required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function counts(label: string) {
  const [{ c }] = await sql<{ c: number }[]>`SELECT (
    (SELECT COUNT(*) FROM customers) +
    (SELECT COUNT(*) FROM jobs) +
    (SELECT COUNT(*) FROM invoices) +
    (SELECT COUNT(*) FROM time_entries) +
    (SELECT COUNT(*) FROM expenses)
  )::int AS c`;
  console.log(`[${label}] customer+job+invoice+time+expense total rows: ${c}`);
}

async function main() {
  await counts('before');

  await sql.begin(async (tx) => {
    // Break the customer ↔ rate_schedule + employee FKs first so the
    // dependency walk can proceed without ON DELETE chains.
    await tx`UPDATE customers SET default_rate_schedule_id = NULL,
                                    overhead_employee_id = NULL,
                                    overhead_hourly_rate = NULL,
                                    overhead_percent = NULL`;

    // Snapshot + invoice rollups
    await tx`DELETE FROM invoice_emails`;
    await tx`DELETE FROM invoice_line_items`;
    await tx`DELETE FROM invoice_summary_members`;
    await tx`DELETE FROM invoice_summaries`;

    // Unbind so we can delete the invoices, then bury them
    await tx`UPDATE time_entries SET invoice_id = NULL`;
    await tx`UPDATE expenses     SET invoice_id = NULL`;
    await tx`DELETE FROM invoices`;

    // Inbox documents that were already turned into expenses are FK'd to the
    // expense; raw ones reference jobs. Wipe the whole inbox.
    await tx`DELETE FROM expense_attachments`;
    await tx`DELETE FROM expenses`;
    await tx`DELETE FROM inbox_documents`;

    // Time entries (employees stay; the FK is fine)
    await tx`DELETE FROM time_entries`;

    // Jobs
    await tx`DELETE FROM jobs`;

    // Rate schedule lines first, then schedules
    await tx`DELETE FROM rate_schedule_lines`;
    await tx`DELETE FROM rate_schedules`;

    // Customer-level config
    await tx`DELETE FROM customer_markup_defaults`;
    await tx`DELETE FROM customers`;
  });

  // Disk: blow away the per-entity storage trees but keep the root + branding.
  for (const sub of ['expenses', 'invoices', 'invoice-summaries', 'inbox']) {
    const p = join(STORAGE_ROOT!, sub);
    try {
      await rm(p, { recursive: true, force: true });
      console.log(`deleted ${p}`);
    } catch (e) {
      console.warn(`skip ${p}: ${(e as Error).message}`);
    }
  }

  await counts('after');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
