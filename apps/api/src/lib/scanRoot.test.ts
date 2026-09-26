import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWithinScanRoot } from './scanRoot.js';

describe('isWithinScanRoot', () => {
  it('allows any path when no scan root is configured', () => {
    expect(isWithinScanRoot('/anywhere/at/all', undefined)).toBe(true);
  });

  it('allows the scan root itself', () => {
    expect(isWithinScanRoot('/srv/projects', '/srv/projects')).toBe(true);
  });

  it('allows a path nested inside the scan root', () => {
    expect(isWithinScanRoot(join('/srv/projects', 'demo'), '/srv/projects')).toBe(true);
  });

  it('rejects a path outside the scan root', () => {
    expect(isWithinScanRoot('/etc/passwd', '/srv/projects')).toBe(false);
  });

  it('rejects a sibling directory with a matching prefix', () => {
    expect(isWithinScanRoot('/srv/projects-evil/demo', '/srv/projects')).toBe(false);
  });
});
