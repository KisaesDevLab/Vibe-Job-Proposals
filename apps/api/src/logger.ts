// Winston JSON logger to stdout (Phase 1 task 19).
import winston from 'winston';
import { config } from './config.js';

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});
