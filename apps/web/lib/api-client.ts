const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** Client-side fetch wrapper. Always sends the session cookie (`credentials: 'include'`). */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    // Fastify's JSON body parser rejects an empty body when Content-Type is set to
    // application/json (e.g. the no-body logout call), so only set it when there's
    // actually a body to send.
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });

  const body = (await response.json().catch(() => null)) as (T & ErrorBody) | null;

  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? 'Ocorreu um erro inesperado.',
      response.status,
    );
  }

  return body as T;
}
