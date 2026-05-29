// Storage path helpers under STORAGE_ROOT.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export const STORAGE = config.STORAGE_ROOT;

export const paths = {
  branding: () => ensure(join(STORAGE, 'branding')),
  expenseDir: (expenseId: string) => ensure(join(STORAGE, 'expenses', expenseId)),
  expensePending: (expenseId: string) => ensure(join(STORAGE, 'expenses', expenseId, '_pending')),
  invoicesDir: () => ensure(join(STORAGE, 'invoices')),
  importsDir: () => ensure(join(STORAGE, 'imports')),
  backupsDir: () => ensure(join(STORAGE, 'backups')),
};

function ensure(p: string): string {
  mkdirSync(p, { recursive: true, mode: 0o700 });
  return p;
}

export function initStorage(): void {
  paths.branding();
  paths.invoicesDir();
  paths.importsDir();
}
