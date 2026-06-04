// The stream error handler is the fix for unhandled 'error' events on
// createReadStream(...).pipe(res) — those escape ah() and crash the process.
// Mock the logger so importing this module doesn't pull in config (which would
// validate env at import time).
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';

vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { attachStreamErrorHandler } from './http-stream.js';

function mockRes(headersSent: boolean) {
  return {
    headersSent,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    destroy: vi.fn(),
  };
}

describe('attachStreamErrorHandler', () => {
  it('returns a 500 envelope when the stream errors before headers are sent', () => {
    const res = mockRes(false);
    const stream = new PassThrough();
    attachStreamErrorHandler(stream, res as never, { route: 'test' });

    stream.emit('error', new Error('EIO: read failed'));

    expect(res.statusCode).toBe(500);
    expect((res.body as { ok: boolean }).ok).toBe(false);
    expect((res.body as { error: { code: string } }).error.code).toBe('stream_error');
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('destroys the connection when the stream errors after headers are already sent', () => {
    const res = mockRes(true);
    const stream = new PassThrough();
    attachStreamErrorHandler(stream, res as never, { route: 'test' });

    const err = new Error('EIO: read failed mid-stream');
    stream.emit('error', err);

    expect(res.destroy).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined(); // can't send an envelope after headers
  });
});
