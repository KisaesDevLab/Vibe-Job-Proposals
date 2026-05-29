// Central error handler (Phase 20 task 16). Returns the standard envelope.
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { fail } from '@darrow/shared';
import { logger } from './logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json(fail('validation', 'Validation failed', err.flatten()));
    return;
  }
  const e = err as { status?: number; code?: string; message?: string; details?: unknown };
  const status = e.status ?? 500;
  if (status >= 500) {
    logger.error('request error', { path: req.path, method: req.method, err: String(err), stack: (err as Error)?.stack });
  }
  res.status(status).json(fail(e.code ?? 'internal', e.message ?? 'Internal error', e.details));
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Wrap async route handlers to forward rejections to the error handler.
export function ah<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}
