import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/darrow_ti';

// Single shared connection pool. Disable prepared statements for compatibility
// with transaction-pooled deployments.
export const sql = postgres(DATABASE_URL, { max: 10, prepare: false });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
