// Standard API envelope — CLAUDE.md §1.3.

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: ApiError };
export type ApiResponse<T> = ApiOk<T> | ApiFail;

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}
export function fail(code: string, message: string, details?: unknown): ApiFail {
  return { ok: false, error: { code, message, details } };
}
