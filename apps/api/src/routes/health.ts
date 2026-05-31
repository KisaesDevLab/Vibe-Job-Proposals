import { Router } from 'express';
import { sql as rawsql } from '@darrow/db';
import { redisPing } from '../queue.js';

export const healthRouter = Router();
const VERSION = process.env.npm_package_version ?? '1.0.0';

healthRouter.get('/', async (_req, res) => {
  let dbUp = false;
  try {
    await rawsql`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
  }
  const redisUp = await redisPing();
  res.status(dbUp && redisUp ? 200 : 503).json({
    ok: dbUp && redisUp,
    db: dbUp ? 'up' : 'down',
    redis: redisUp ? 'up' : 'down',
    version: VERSION,
  });
});
