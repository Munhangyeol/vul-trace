/**
 * Port errors worth retrying. On Windows, binding right after the previous server on that port
 * was force-killed fails for a moment with EFAULT ("bad address in system call argument")
 * rather than EADDRINUSE.
 */
const PORT_ERROR_CODES = new Set(['EADDRINUSE', 'EFAULT', 'EACCES']);

/** Exit code the API uses when it could not bind its port — dev.ts stops the watcher on it. */
export const EXIT_PORT_UNAVAILABLE = 3;

export function isPortError(error: unknown): boolean {
  return PORT_ERROR_CODES.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
}

export interface ListenRetryOptions {
  attempts: number;
  delayMs: number;
  onRetry?: (error: unknown, attempt: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Calls `listen` until it succeeds; only port errors are retried, anything else is thrown at once. */
export async function listenWithRetry<T>(
  listen: () => Promise<T>,
  options: ListenRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await listen();
    } catch (error) {
      if (!isPortError(error) || attempt >= options.attempts) throw error;
      options.onRetry?.(error, attempt);
      await sleep(options.delayMs);
    }
  }
}
