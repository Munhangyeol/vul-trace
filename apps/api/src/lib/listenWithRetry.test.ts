import { describe, expect, it, vi } from 'vitest';
import { isPortError, listenWithRetry } from './listenWithRetry.js';

const errno = (code: string) => Object.assign(new Error(code), { code });
const noSleep = async () => undefined;

describe('listenWithRetry', () => {
  it('retries port errors and returns once listen succeeds', async () => {
    const listen = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(errno('EFAULT'))
      .mockRejectedValueOnce(errno('EADDRINUSE'))
      .mockResolvedValueOnce('listening');
    const onRetry = vi.fn();

    await expect(
      listenWithRetry(listen, { attempts: 5, delayMs: 1, onRetry, sleep: noSleep }),
    ).resolves.toBe('listening');
    expect(listen).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt with the port error', async () => {
    const listen = vi.fn<() => Promise<string>>().mockRejectedValue(errno('EADDRINUSE'));

    await expect(
      listenWithRetry(listen, { attempts: 3, delayMs: 1, sleep: noSleep }),
    ).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    expect(listen).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const listen = vi.fn<() => Promise<string>>().mockRejectedValue(errno('ENOTFOUND'));

    await expect(
      listenWithRetry(listen, { attempts: 5, delayMs: 1, sleep: noSleep }),
    ).rejects.toMatchObject({
      code: 'ENOTFOUND',
    });
    expect(listen).toHaveBeenCalledTimes(1);
  });
});

describe('isPortError', () => {
  it('recognizes Windows EFAULT as a port error', () => {
    expect(isPortError(errno('EFAULT'))).toBe(true);
    expect(isPortError(errno('ECONNRESET'))).toBe(false);
    expect(isPortError(undefined)).toBe(false);
  });
});
