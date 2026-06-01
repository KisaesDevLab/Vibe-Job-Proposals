import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import helmet from 'helmet';
import { fail } from '@darrow/shared';
import { config, isProd } from './config.js';
import { redis } from './redis.js';
import { errorHandler } from './error-handler.js';
import { requireAuth } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { auditRouter } from './routes/audit.js';
import { settingsRouter } from './routes/settings.js';
import { rateLevelsRouter } from './routes/rate-levels.js';
import { employeesRouter } from './routes/employees.js';
import { customersRouter } from './routes/customers.js';
import { rateSchedulesRouter, customerScheduleRouter } from './routes/rate-schedules.js';
import { jobsRouter } from './routes/jobs.js';
import { timeRouter } from './routes/time.js';
import { expensesRouter } from './routes/expenses.js';
import { inboxRouter } from './routes/inbox.js';
import { invoicesRouter } from './routes/invoices.js';
import { invoiceSummariesRouter } from './routes/invoice-summaries.js';
import { reportsRouter } from './routes/reports.js';

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", 'data:'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: 'darrow:sess:' }),
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        maxAge: 14 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // CSRF defense: custom header required on mutating requests (Phase 20 task 18).
  // The public upload endpoints are sessionless + token-gated, so cookie-CSRF
  // doesn't apply — exempt them so non-SPA clients aren't blocked.
  app.use((req, res, next) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !req.path.startsWith('/api/auth/login') &&
      !req.path.startsWith('/api/public/')
    ) {
      if (req.get('x-requested-with') !== 'darrow') {
        // Allow same-origin form posts for file uploads via multipart only if header present.
        return res.status(403).json(fail('csrf', 'Missing X-Requested-With header'));
      }
    }
    next();
  });

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter); // sessionless, token-gated; before requireAuth

  // everything below requires auth
  app.use('/api', requireAuth);

  app.use('/api/audit', auditRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/rate-levels', rateLevelsRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/customers/:id/rate-schedules', customerScheduleRouter);
  app.use('/api/rate-schedules', rateSchedulesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/time', timeRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/invoice-summaries', invoiceSummariesRouter);
  app.use('/api/reports', reportsRouter);

  app.use('/api', (_req, res) => res.status(404).json(fail('not_found', 'Route not found')));

  // In production, serve the built SPA and fall back to index.html for client routes.
  if (isProd) {
    const webDist = join(process.cwd(), 'apps', 'web', 'dist');
    if (existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (_req, res) => res.sendFile(join(webDist, 'index.html')));
    }
  }

  app.use(errorHandler);
  return app;
}
