import type { AffectedRange } from '@vulntrace/shared';
import { describe, expect, it } from 'vitest';
import { isAffected } from './isAffected.js';

const ecosystem = (...events: AffectedRange['events']): AffectedRange => ({ type: 'ECOSYSTEM', events });
const evidence = (ranges: AffectedRange[], versions: string[] = []) => ({ affectedRanges: ranges, affectedVersions: versions });

describe('isAffected (OSV ECOSYSTEM ranges, Maven ordering)', () => {
  it('handles introduced 0 → fixed', () => {
    const e = evidence([ecosystem({ introduced: '0' }, { fixed: '1.10.0' })]);
    expect(isAffected('1.9', e)).toBe('AFFECTED');
    expect(isAffected('1.10.0', e)).toBe('NOT_AFFECTED');
    expect(isAffected('1.10.1', e)).toBe('NOT_AFFECTED');
  });

  it('evaluates several release lines (real jackson-databind data)', () => {
    const e = evidence([
      ecosystem({ introduced: '2.6.0' }, { fixed: '2.6.7.4' }),
      ecosystem({ introduced: '2.7.0.0' }, { fixed: '2.9.10.7' }),
      ecosystem({ introduced: '2.10.0.0' }, { fixed: '2.10.5.1' }),
    ]);
    expect(isAffected('2.9.8', e)).toBe('AFFECTED');
    expect(isAffected('2.9.10.7', e)).toBe('NOT_AFFECTED');
    expect(isAffected('2.10.0', e)).toBe('AFFECTED');
    expect(isAffected('2.10.5.1', e)).toBe('NOT_AFFECTED');
    expect(isAffected('2.12.0', e)).toBe('NOT_AFFECTED');
    expect(isAffected('2.5.0', e)).toBe('NOT_AFFECTED');
  });

  it('closes a span after last_affected and caps it at limit', () => {
    const lastAffected = evidence([ecosystem({ introduced: '1.0' }, { lastAffected: '1.5' })]);
    expect(isAffected('1.5', lastAffected)).toBe('AFFECTED');
    expect(isAffected('1.5.1', lastAffected)).toBe('NOT_AFFECTED');
    const limited = evidence([ecosystem({ introduced: '0' }, { limit: '2.0' })]);
    expect(isAffected('1.9', limited)).toBe('AFFECTED');
    expect(isAffected('2.0', limited)).toBe('NOT_AFFECTED');
  });

  it('uses the explicit versions list', () => {
    expect(isAffected('1.2.3', evidence([], ['1.2.3']))).toBe('AFFECTED');
    expect(isAffected('1.2.4', evidence([], ['1.2.3']))).toBe('NOT_AFFECTED');
  });

  it('says UNKNOWN instead of guessing', () => {
    expect(isAffected('1.0', evidence([{ type: 'GIT', events: [{ introduced: 'abc' }] }]))).toBe('UNKNOWN');
    expect(isAffected('${v}', evidence([ecosystem({ introduced: '0' }, { fixed: '1.0' })]))).toBe('UNKNOWN');
    expect(isAffected('1.0', evidence([ecosystem({ introduced: '0' }, { fixed: '[2,3)' })]))).toBe('UNKNOWN');
    expect(isAffected('1.0', evidence([]))).toBe('UNKNOWN');
  });
});
