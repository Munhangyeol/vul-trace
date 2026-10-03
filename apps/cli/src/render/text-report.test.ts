import { describe, expect, it } from 'vitest';
import type { ScanReport } from '@vulntrace/core';
import type { VulnerabilityFinding } from '@vulntrace/shared';
import { renderDependencies, renderSummary, renderVulnerabilities, renderVulnerabilityTable } from './text-report.js';

const baseReport: ScanReport = {
  projectPath: '/repo/fixtures/spring-vulnerable-used',
  state: 'COMPLETED',
  startedAt: '2026-10-03T00:00:00Z',
  finishedAt: '2026-10-03T00:00:01Z',
  stages: [
    { stage: 'PROJECT_DETECTION', status: 'SUCCEEDED' },
    { stage: 'DEPENDENCY', status: 'SUCCEEDED' },
    { stage: 'DEPENDENCY_TREE', status: 'SUCCEEDED' },
    { stage: 'SBOM', status: 'SUCCEEDED' },
    { stage: 'VULNERABILITY', status: 'SUCCEEDED' },
    { stage: 'SOURCE_USAGE', status: 'SKIPPED', reason: 'not implemented (Phase 4)' },
    { stage: 'SPRING_ENDPOINT', status: 'SKIPPED', reason: 'not implemented (Phase 5)' },
    { stage: 'REACHABILITY', status: 'SKIPPED', reason: 'not implemented (Phase 6)' },
    { stage: 'RISK', status: 'SKIPPED', reason: 'not implemented (Phase 7)' },
  ],
  dependencies: [
    {
      coordinate: {
        groupId: 'org.apache.commons',
        artifactId: 'commons-text',
        version: '1.9',
        scope: 'compile',
        direct: true,
        purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      },
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    },
  ],
  unresolvedDependencies: [],
  findings: [],
  vulnerabilityCoverage: { checked: 1, notChecked: 0, failed: 0 },
  warnings: [],
};

const finding: VulnerabilityFinding = {
  vulnerability: {
    id: 'CVE-2022-42889',
    aliases: ['CVE-2022-42889'],
    summary: 'Apache Commons Text RCE',
    severity: 'CRITICAL',
    severitySource: 'CVSS_V3',
    cvssScore: 9.8,
    modified: '2022-10-01T00:00:00Z',
    references: [],
  },
  package: {
    ecosystem: 'Maven',
    name: 'org.apache.commons:commons-text',
    version: '1.9',
    purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
  },
  fixedVersions: ['1.10.0'],
  evidence: {
    provider: 'OSV',
    queriedAt: '2022-10-01T00:00:00Z',
    affectedRanges: [],
    affectedVersions: ['1.9'],
  },
};

describe('renderSummary', () => {
  it('prints the CLAUDE.md summary block for a completed scan with findings', () => {
    const report: ScanReport = { ...baseReport, findings: [finding] };
    expect(renderSummary(report)).toBe(
      [
        'Project: spring-vulnerable-used',
        'State:   COMPLETED',
        '',
        'Dependencies:      1',
        'Vulnerabilities:   1',
        'Critical:          1',
        'High:              0',
      ].join('\n'),
    );
  });

  it('notes unresolved dependencies', () => {
    const report: ScanReport = {
      ...baseReport,
      unresolvedDependencies: [
        {
          groupId: 'com.example',
          artifactId: 'managed-dep',
          scope: 'compile',
          reason: 'VERSION_MANAGED_BY_PARENT',
          source: { kind: 'pom.xml', filePath: 'pom.xml' },
        },
      ],
    };
    expect(renderSummary(report)).toContain('Dependencies:      1   (1 unresolved — not checked)');
  });

  it('shows 0 vulnerabilities and no table when VULNERABILITY is skipped', () => {
    const report: ScanReport = {
      ...baseReport,
      stages: baseReport.stages.map((s) =>
        s.stage === 'VULNERABILITY' ? { stage: s.stage, status: 'SKIPPED', reason: 'vulnerability check disabled' } : s,
      ),
    };
    expect(renderSummary(report)).toContain('Vulnerabilities:   0');
    expect(renderSummary(report)).toContain('Warning: SKIPPED — vulnerability check disabled');
    expect(renderVulnerabilityTable(report)).toBe('');
  });

  it('reports dependency unavailable when project detection failed', () => {
    const report: ScanReport = {
      ...baseReport,
      state: 'FAILED',
      dependencies: [],
      stages: [
        { stage: 'PROJECT_DETECTION', status: 'FAILED', reason: 'PROJECT_NOT_FOUND: no pom.xml' },
        { stage: 'DEPENDENCY', status: 'FAILED', reason: 'no dependency analysis result' },
        { stage: 'SBOM', status: 'SKIPPED', reason: 'no dependency analysis result' },
        { stage: 'VULNERABILITY', status: 'SKIPPED', reason: 'no dependency analysis result' },
      ],
    };
    expect(renderSummary(report)).toBe(
      ['Project: spring-vulnerable-used', 'State:   FAILED', '', 'Dependencies: unavailable (FAILED — PROJECT_NOT_FOUND: no pom.xml)'].join(
        '\n',
      ),
    );
  });
});

describe('renderVulnerabilityTable', () => {
  it('renders a sorted table of findings', () => {
    const report: ScanReport = { ...baseReport, findings: [finding] };
    expect(renderVulnerabilityTable(report)).toBe(
      [
        'ID               Severity  CVSS  Dependency                                Fixed',
        'CVE-2022-42889   CRITICAL  9.8   org.apache.commons:commons-text@1.9      1.10.0',
      ].join('\n'),
    );
  });

  it('is empty when there are no findings', () => {
    expect(renderVulnerabilityTable(baseReport)).toBe('');
  });
});

describe('renderDependencies', () => {
  it('lists resolved dependencies', () => {
    expect(renderDependencies(baseReport)).toContain('Dependencies: 1');
    expect(renderDependencies(baseReport)).toContain('pkg:maven/org.apache.commons/commons-text@1.9');
  });
});

describe('renderVulnerabilities', () => {
  it('includes coverage note and the vulnerability table', () => {
    const report: ScanReport = { ...baseReport, findings: [finding] };
    const text = renderVulnerabilities(report);
    expect(text).toContain('Vulnerabilities: 1   (checked 1 dependencies)');
    expect(text).toContain('CVE-2022-42889');
  });
});
