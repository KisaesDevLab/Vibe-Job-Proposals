// Safe file streaming for HTTP responses.
//
// `createReadStream(path).pipe(res)` is used throughout the routes to serve
// generated/uploaded files. The path is existsSync-checked first, but a read
// error AFTER that check (file deleted mid-request, permission/IO failure) emits
// an 'error' event on the stream. With no listener Node treats it as an
// unhandled error and crashes the process — and because it happens inside a
// stream event, not the handler promise, it escapes `ah()`'s `.catch(next)`.
//
// Attach this to every read stream piped to a response so the failure is logged
// with context and converted into the standard error envelope (or a clean
// connection teardown if the response was already partially sent).
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { fail } from '@darrow/shared';
import { logger } from './logger.js';

export function attachStreamErrorHandler(stream: Readable, res: Response, context: Record<string, unknown>): void {
  stream.on('error', (err: unknown) => {
    logger.error('file stream error', { ...context, err: String(err) });
    if (!res.headersSent) {
      res.status(500).json(fail('stream_error', 'Failed to read file'));
    } else {
      // Headers/body already flushed — we can't send an envelope; tear the
      // connection down so the client sees a truncated (failed) download
      // rather than a silently-incomplete file.
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
