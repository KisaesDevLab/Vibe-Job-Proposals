import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

// maxRetriesPerRequest must be null for BullMQ-compatible clients, but the API's
// own client is used only for sessions + rate limiting.
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

// Without an 'error' listener an ioredis connection error is unhandled and
// crashes the API process. Log and let ioredis auto-reconnect.
redis.on('error', (err: unknown) => logger.error('redis client error', { err: String(err) }));
