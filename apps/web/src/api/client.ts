import type { ErrorResponseDto } from '@vulntrace/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response, fallbackMessage: string): Promise<ApiError> {
  let body: Partial<ErrorResponseDto> | undefined;
  try {
    body = (await res.json()) as ErrorResponseDto;
  } catch {
    body = undefined;
  }
  return new ApiError(res.status, body?.error ?? 'UNKNOWN', body?.message ?? fallbackMessage);
}

/** Thin fetch wrapper. Response types come from @vulntrace/shared / API DTOs. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw await toApiError(res, `GET /api${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toApiError(res, `POST /api${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
