import { Redis } from 'ioredis';
import winston from 'winston';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

export const STORAGE = process.env.STORAGE_ROOT ?? '/storage';
