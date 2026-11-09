/** Low-level HTTP client: same-origin cookies, CSRF header, consistent errors. */

export class ApiError extends Error {
  /** `code` is the server's machine-readable reason (e.g. "email_unverified"); `data` is the full body. */
  constructor(public status: number, message: string, public code?: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // The custom header is part of the server's CSRF defence.
      headers: { 'X-Requested-With': 'fetch', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as Record<string, unknown>;
    throw new ApiError(res.status, errorMessage(data, res.status), typeof body.code === 'string' ? body.code : undefined, body);
  }
  return data as T;
}

function errorMessage(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error, /, '')).join('. ');
  }
  return `Request failed (${status})`;
}
