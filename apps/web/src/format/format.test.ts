import { describe, expect, it } from 'vitest';
import { formatDate } from './date';
import { formatFixedVersions } from './fixedVersions';
import { formatSeverity } from './severity';

describe('formatSeverity', () => {
  it('title-cases a severity value', () => {
    expect(formatSeverity('CRITICAL')).toBe('Critical');
    expect(formatSeverity('UNKNOWN')).toBe('Unknown');
  });

  it('returns an empty string unchanged', () => {
    expect(formatSeverity('')).toBe('');
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp as a date', () => {
    expect(formatDate('2022-10-01T12:34:56.000Z')).toBe('2022-10-01');
  });

  it('returns an em dash for missing or invalid input', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatFixedVersions', () => {
  it('joins multiple fixed versions', () => {
    expect(formatFixedVersions(['1.10.0', '2.0.0'])).toBe('1.10.0, 2.0.0');
  });

  it('says "no fix" when OSV reports none, instead of a blank value', () => {
    expect(formatFixedVersions([])).toBe('no fix');
  });
});
