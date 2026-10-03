import { describe, expect, it } from 'vitest';
import type { ProjectDependency, UnresolvedDependency, VulnerabilityFinding } from '@vulntrace/shared';
import { summarizeScan } from './summarizeScan.js';

const dep = (purl: string): ProjectDependency => ({
  coordinate: {
    groupId: 'org.apache.commons',
    artifactId: 'commons-text',
    version: '1.9',
    scope: 'compile',
    direct: true,
    purl,
  },
  source: { kind: 'pom.xml', filePath: 'pom.xml' },
});

const unresolved = (artifactId: string): UnresolvedDependency => ({
  groupId: 'com.example',
  artifactId,
  scope: 'compile',
  reason: 'VERSION_MANAGED_BY_PARENT',
  source: { kind: 'pom.xml', filePath: 'pom.xml' },
});

const finding = (
  overrides: Partial<VulnerabilityFinding['vulnerability']> = {},
  purl = 'pkg:maven/org.apache.commons/commons-text@1.9',
): VulnerabilityFinding => ({
  vulnerability: {
    id: 'CVE-2022-42889',
    aliases: ['CVE-2022-42889'],
    summary: 'RCE',
    severity: 'CRITICAL',
    severitySource: 'CVSS_V3',
    cvssScore: 9.8,
    modified: '2022-10-01T00:00:00Z',
    references: [],
    ...overrides,
  },
  package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl },
  fixedVersions: ['1.10.0'],
  evidence: { provider: 'OSV', queriedAt: '2022-10-01T00:00:00Z', affectedRanges: [], affectedVersions: ['1.9'] },
});

describe('summarizeScan', () => {
  it('counts dependencies, unresolved, and empty findings', () => {
    const summary = summarizeScan({
      dependencies: [dep('pkg:maven/a/a@1')],
      unresolvedDependencies: [unresolved('b')],
      findings: [],
      vulnerabilityCoverage: { checked: 1, notChecked: 1, failed: 0 },
    });

    expect(summary).toEqual({
      dependencies: 1,
      unresolved: 1,
      vulnerabilities: 0,
      findings: 0,
      vulnerableDependencies: 0,
      bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
      coverage: { checked: 1, notChecked: 1, failed: 0 },
    });
  });

  it('counts findings and deduplicates vulnerabilities by id for bySeverity', () => {
    const f = finding();
    const summary = summarizeScan({
      dependencies: [dep(f.package.purl)],
      unresolvedDependencies: [],
      findings: [f, f],
      vulnerabilityCoverage: { checked: 1, notChecked: 0, failed: 0 },
    });

    expect(summary.findings).toBe(2);
    expect(summary.vulnerabilities).toBe(1);
    expect(summary.vulnerableDependencies).toBe(1);
    expect(summary.bySeverity.CRITICAL).toBe(1);
  });

  it('counts distinct vulnerable dependencies across different packages', () => {
    const a = finding({}, 'pkg:maven/a/a@1');
    const b = finding({ id: 'CVE-2021-1', aliases: ['CVE-2021-1'], severity: 'HIGH' }, 'pkg:maven/b/b@1');
    const summary = summarizeScan({
      dependencies: [dep(a.package.purl), dep(b.package.purl)],
      unresolvedDependencies: [],
      findings: [a, b],
      vulnerabilityCoverage: { checked: 2, notChecked: 0, failed: 0 },
    });

    expect(summary.vulnerableDependencies).toBe(2);
    expect(summary.vulnerabilities).toBe(2);
    expect(summary.bySeverity).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
  });
});
