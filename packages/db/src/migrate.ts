// Idempotent migration runner. Applies numbered SQL files in order, recording
// applied filenames in a _migrations table so re-runs are no-ops.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<string[]> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const applied: string[] = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const done = new Set(
      (await sql`SELECT filename FROM _migrations`).map((r) => r.filename as string),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO _migrations (filename) VALUES (${file})`;
      });
      applied.push(file);
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${file}`);
    }
    if (applied.length === 0) console.log('[migrate] up to date');
  } finally {
    await sql.end({ timeout: 5 });
  }
  return applied;
}

// Run when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(
    () => process.exit(0),
    (err) => {
      console.error('[migrate] failed', err);
      process.exit(1);
    },
  );
}
