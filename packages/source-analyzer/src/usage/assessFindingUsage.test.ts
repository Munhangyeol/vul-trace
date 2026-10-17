import { describe, expect, it } from 'vitest';
import type { VulnerabilityFinding } from '@vulntrace/shared';
import { assessFindingUsage } from './assessFindingUsage.js';
import type { DependencyUsage, MatchedUsage } from './UsageMatcher.js';

const PURL = 'pkg:maven/org.apache.commons/commons-text@1.9';

const finding = (id: string, aliases: string[] = []): VulnerabilityFinding => ({
  vulnerability: {
    id,
    aliases,
    summary: 'test',
    severity: 'CRITICAL',
    severitySource: 'CVSS_V3',
    modified: '2022-10-01T00:00:00Z',
    references: [],
  },
  package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl: PURL },
  fixedVersions: ['1.10.0'],
  evidence: { provider: 'OSV', queriedAt: '2022-10-01T00:00:00Z', affectedRanges: [], affectedVersions: [] },
});

const usage = (kind: MatchedUsage['kind'], symbol: string, sourceSet: MatchedUsage['sourceSet'] = 'MAIN'): MatchedUsage => ({
  kind,
  symbol,
  dependencyPurl: PURL,
  sourceSet,
  evidence: { location: { filePath: 'src/main/java/A.java', line: 1 }, snippet: '' },
});

const dependencyUsage = (usages: MatchedUsage[]): DependencyUsage => ({
  purl: PURL,
  packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
  usages,
});

describe('assessFindingUsage', () => {
  it('Case A: declared but unused → used=false, vulnerable API not detected', () => {
    const result = assessFindingUsage(finding('GHSA-599f-7c49-w659', ['CVE-2022-42889']), dependencyUsage([]));
    expect(result).toMatchObject({ used: false, vulnerableApi: 'NOT_DETECTED', usages: [] });
    expect(result.vulnerableApis).toContainEqual({
      type: 'org.apache.commons.text.StringSubstitutor',
      method: 'createInterpolator',
    });
  });

  it('marks the usage that calls a known vulnerable API (matched by alias)', () => {
    const result = assessFindingUsage(
      finding('GHSA-599f-7c49-w659', ['CVE-2022-42889']),
      dependencyUsage([
        usage('IMPORT', 'org.apache.commons.text.StringSubstitutor'),
        usage('METHOD_CALL', 'org.apache.commons.text.StringSubstitutor#createInterpolator'),
        usage('METHOD_CALL', 'org.apache.commons.text.StringSubstitutor#replace'),
      ]),
    );
    expect(result.used).toBe(true);
    expect(result.vulnerableApi).toBe('USED');
    expect(result.usages.map((u) => u.vulnerableApi)).toEqual([false, true, false]);
  });

  it('is used but NOT_DETECTED when only non-vulnerable APIs are called', () => {
    const result = assessFindingUsage(
      finding('CVE-2022-42889'),
      dependencyUsage([usage('OBJECT_CONSTRUCTION', 'org.apache.commons.text.StringSubstitutor')]),
    );
    expect(result).toMatchObject({ used: true, vulnerableApi: 'NOT_DETECTED' });
  });

  it('reports NO_API_INFO when the vulnerability has no curated API list', () => {
    const result = assessFindingUsage(
      finding('GHSA-unknown'),
      dependencyUsage([usage('IMPORT', 'org.apache.commons.text.StringSubstitutor')]),
    );
    expect(result).toMatchObject({ used: true, vulnerableApi: 'NO_API_INFO', vulnerableApis: [] });
  });

  it('ignores TEST-only usages for used / vulnerableApi but keeps them as evidence', () => {
    const result = assessFindingUsage(
      finding('CVE-2022-42889'),
      dependencyUsage([usage('METHOD_CALL', 'org.apache.commons.text.StringSubstitutor#createInterpolator', 'TEST')]),
    );
    expect(result).toMatchObject({ used: false, vulnerableApi: 'NOT_DETECTED' });
    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]?.vulnerableApi).toBe(true);
  });
});
