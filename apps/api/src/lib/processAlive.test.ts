import { describe, expect, it } from 'vitest';
import { isProcessAlive } from './processAlive.js';

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('isProcessAlive', () => {
  it('is true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false when the process does not exist', () => {
    expect(
      isProcessAlive(123, () => {
        throw errno('ESRCH');
      }),
    ).toBe(false);
  });

  it('is true when the process exists but cannot be signalled', () => {
    expect(
      isProcessAlive(123, () => {
        throw errno('EPERM');
      }),
    ).toBe(true);
  });
});
