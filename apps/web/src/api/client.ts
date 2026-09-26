export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thin fetch wrapper. Response types come from @vulntrace/shared / API DTOs. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiError(res.status, `GET /api${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}
