// Idempotent application seed (beyond the seeds baked into migrations).
// Seeds the 9 historical customers (Phase 6 task 25) with empty addresses.
import { pathToFileURL } from 'node:url';
import { db, sql } from './client.js';
import { customers } from './schema.js';

const SEED_CUSTOMERS = [
  'Jasper Products',
  'Bagcraft',
  'Nutra Blend',
  'Sugar Creek',
  'Diamond Pet Foods',
  'Graham Packaging',
  'Modine',
  'Eagle Picher',
  'Darlington',
];

export async function seed(): Promise<void> {
  for (const name of SEED_CUSTOMERS) {
    await db.insert(customers).values({ name }).onConflictDoNothing({ target: customers.name });
  }
  // eslint-disable-next-line no-console
  console.log(`[seed] ensured ${SEED_CUSTOMERS.length} customers`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => sql.end({ timeout: 5 }))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed', err);
      process.exit(1);
    });
}
