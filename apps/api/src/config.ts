// Env config validated at startup (CLAUDE.md Phase 1 task 18). Crash on missing.
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  STORAGE_ROOT: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LIBREOFFICE_BIN: z.string().default('/usr/bin/libreoffice'),
  PORT: z.coerce.number().default(4000),
  SMTP_ENC_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[config] invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
