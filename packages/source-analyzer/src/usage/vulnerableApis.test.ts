import { describe, expect, it } from 'vitest';
import type { VulnerabilityFinding } from '@vulntrace/shared';
import { findVulnerableApis } from './vulnerableApis.js';

const finding = (id: string, aliases: string[] = []): VulnerabilityFinding => ({
  vulnerability: {
    id,
    aliases,
    summary: 'test',
    severity: 'HIGH',
    severitySource: 'CVSS_V3',
    modified: '2022-10-01T00:00:00Z',
    references: [],
  },
  package: { ecosystem: 'Maven', name: 'g:a', version: '1', purl: 'pkg:maven/g/a@1' },
  fixedVersions: [],
  evidence: {
    provider: 'OSV',
    queriedAt: '2022-10-01T00:00:00Z',
    affectedRanges: [],
    affectedVersions: [],
  },
});

describe('findVulnerableApis', () => {
  it.each([
    ['GHSA-jfh8-c2jp-5v3q', 'org.apache.logging.log4j.Logger', 'error'],
    ['CVE-2021-44228', 'org.slf4j.Logger', 'info'],
    ['GHSA-7rjr-3q55-vv33', 'org.apache.logging.log4j.ThreadContext', 'put'],
    ['GHSA-p6xc-xr62-6r2g', 'org.slf4j.MDC', 'put'],
    ['GHSA-mjmj-j48q-9wg2', 'org.yaml.snakeyaml.Yaml', 'load'],
    ['GHSA-3mc7-4q67-w48m', 'org.yaml.snakeyaml.Yaml', 'loadAll'],
    ['GHSA-xjrr-xv9m-4pw5', 'com.alibaba.fastjson.JSON', 'parseObject'],
    [
      'GHSA-558x-2xjg-6232',
      'org.springframework.expression.spel.standard.SpelExpressionParser',
      'parseExpression',
    ],
  ])('%s includes %s#%s', (id, type, method) => {
    expect(findVulnerableApis(finding(id))).toContainEqual({ type, method });
  });

  it('matches through aliases too', () => {
    expect(findVulnerableApis(finding('OSV-X', ['CVE-2022-1471']))).not.toHaveLength(0);
  });

  it('returns nothing for advisories without curated API data (NO_API_INFO, never a guess)', () => {
    expect(findVulnerableApis(finding('GHSA-8489-44mv-ggj8', ['CVE-2021-44832']))).toEqual([]);
    expect(findVulnerableApis(finding('GHSA-jm7w-5684-pvh8'))).toEqual([]);
  });
});
