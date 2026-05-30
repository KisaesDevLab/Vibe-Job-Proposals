// Central error handler (Phase 20 task 16). Returns the standard envelope.
// Only our own HttpError (and ZodError) messages reach the client; any other
// thrown error (library/driver) returns a generic message so internals/schema
// details don't leak.
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { fail } from '@darrow/shared';
import { logger } from './logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json(fail('validation', 'Validation failed', err.flatten()));
    return;
  }
  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json(fail('upload_error', err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'Upload error'));
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }
  // Errors carrying an explicit status (e.g. the invoice service's Object.assign'd
  // 4xx errors) pass their message through; everything else is treated as a 500.
  const e = err as { status?: number; code?: string; message?: string; details?: unknown };
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
    res.status(e.status).json(fail(e.code ?? 'error', e.message ?? 'Request failed', e.details));
    return;
  }
  logger.error('request error', { path: req.path, method: req.method, err: String(err), stack: (err as Error)?.stack });
  res.status(500).json(fail('internal', 'Internal error'));
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
