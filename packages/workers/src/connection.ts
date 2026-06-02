import { Redis } from 'ioredis';
import winston from 'winston';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// Widen the export type to bypass a dep-tree quirk where bullmq pulls its own
// nested copy of ioredis (different RedisOptions identity) and tsc refuses
// `new Worker(..., { connection })`. The runtime object is still a real Redis
// client. Fix is purely a type-system boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const connection: any = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

export const STORAGE = process.env.STORAGE_ROOT ?? '/storage';
