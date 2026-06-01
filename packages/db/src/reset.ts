// Drop + migrate + seed. Guarded to development only (CLAUDE.md Phase 20).
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from './migrate.js';
import { seed } from './seed.js';

async function reset(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset is disabled in production');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const sql = postgres(url, { max: 1, prepare: false });
  // eslint-disable-next-line no-console
  console.log('[reset] dropping public schema');
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await sql.end({ timeout: 5 });
  await runMigrations(url);
  await seed();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset().then(
    () => process.exit(0),
    (err) => {
      console.error('[reset] failed', err);
      process.exit(1);
    },
  );
}
