import { describe, expect, it } from 'vitest';
import { formatDate } from './date';
import { formatFixedVersions } from './fixedVersions';
import type { FindingUsageSummaryDto } from '@vulntrace/shared';
import { formatSeverity } from './severity';
import { formatCommitSha, formatProjectSource } from './source';
import {
  formatPackageMappingBasis,
  formatPurlName,
  formatUsed,
  formatVulnerableApi,
} from './usage';

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

describe('usage formatting', () => {
  const usage: FindingUsageSummaryDto = {
    used: true,
    vulnerableApi: 'USED',
    packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
    vulnerableApis: [],
    mainUsageCount: 3,
    testUsageCount: 0,
  };

  it('distinguishes not analyzed (null) from not used (false)', () => {
    expect(formatUsed(null)).toBe('—');
    expect(formatUsed(usage)).toBe('Yes');
    expect(formatUsed({ ...usage, used: false })).toBe('No');
  });

  it('never presents NOT_DETECTED as proof the vulnerable API is unused', () => {
    expect(formatVulnerableApi('USED')).toBe('vulnerable API used');
    expect(formatVulnerableApi('NOT_DETECTED')).toBe('vulnerable API not detected');
    expect(formatVulnerableApi('NO_API_INFO')).toBe('no vulnerable API info');
  });

  it('labels the package mapping basis', () => {
    expect(formatPackageMappingBasis('CURATED')).toBe('curated mapping');
    expect(formatPackageMappingBasis('GROUP_ID')).toBe('assumed from groupId');
  });
});

describe('formatProjectSource / formatCommitSha', () => {
  const base = { id: 'p', name: 'demo', createdAt: '2026-11-15T00:00:00Z' };

  it('describes local and GitHub sources', () => {
    expect(formatProjectSource({ ...base, sourceType: 'LOCAL', path: 'C:/repos/demo' })).toBe(
      'C:/repos/demo',
    );
    expect(
      formatProjectSource({ ...base, sourceType: 'GIT', repoUrl: 'https://github.com/a/b' }),
    ).toBe('https://github.com/a/b');
    expect(
      formatProjectSource({
        ...base,
        sourceType: 'GIT',
        repoUrl: 'https://github.com/a/b',
        ref: 'v1',
      }),
    ).toBe('https://github.com/a/b (v1)');
  });

  it('shortens a commit SHA and shows a dash when there is none', () => {
    expect(formatCommitSha('0123456789abcdef0123456789abcdef01234567')).toBe('0123456789ab');
    expect(formatCommitSha(undefined)).toBe('—');
  });
});

describe('via-API usage display', () => {
  it('labels a use through an implemented API and shortens purls', () => {
    const summary = {
      used: true,
      viaApi: { path: ['pkg:maven/org.apache.logging.log4j/log4j-api@2.9.1'], reason: 'r' },
      vulnerableApi: 'USED' as const,
      packageMapping: { packages: ['org.apache.logging.log4j.core'], basis: 'CURATED' as const },
      vulnerableApis: [],
      mainUsageCount: 1,
      testUsageCount: 0,
    };
    expect(formatUsed(summary)).toBe('Yes (via API)');
    expect(formatPurlName('pkg:maven/org.apache.logging.log4j/log4j-api@2.9.1')).toBe('log4j-api@2.9.1');
    expect(formatPurlName('not-a-purl')).toBe('not-a-purl');
  });
});

