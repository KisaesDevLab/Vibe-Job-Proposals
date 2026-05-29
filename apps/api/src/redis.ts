import { Redis } from 'ioredis';
import { config } from './config.js';

// maxRetriesPerRequest must be null for BullMQ-compatible clients, but the API's
// own client is used only for sessions + rate limiting.
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
