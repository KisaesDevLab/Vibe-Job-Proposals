// Thin fetch wrapper that always sends the CSRF header and unwraps the
// { ok, data } envelope, throwing ApiError on failure.
export class ApiError extends Error {
  code: string;
  details?: unknown;
  status: number;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'darrow' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'http_error', res.statusText);
    return undefined as T;
  }
  const json = await res.json();
  if (json.ok === false) throw new ApiError(res.status, json.error.code, json.error.message, json.error.details);
  return (json.data ?? json) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body?: unknown) => request<T>('POST', p, body),
  put: <T>(p: string, body?: unknown) => request<T>('PUT', p, body),
  patch: <T>(p: string, body?: unknown) => request<T>('PATCH', p, body),
  del: <T>(p: string, body?: unknown) => request<T>('DELETE', p, body),
  upload: <T>(p: string, file: File, field = 'file') => {
    const fd = new FormData();
    fd.append(field, file);
    return request<T>('POST', p, fd);
  },
};
