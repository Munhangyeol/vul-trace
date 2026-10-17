import { describe, expect, it } from 'vitest';
import type { ScanReport } from '@vulntrace/core';
import type { FindingUsage, VulnerabilityFinding } from '@vulntrace/shared';
import {
  renderDependencies,
  renderSourceUsage,
  renderSummary,
  renderVulnerabilities,
  renderVulnerabilityTable,
} from './text-report.js';

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

const usedUsage: FindingUsage = {
  used: true,
  vulnerableApi: 'USED',
  packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
  vulnerableApis: [{ type: 'org.apache.commons.text.StringSubstitutor', method: 'createInterpolator' }],
  usages: [
    {
      kind: 'IMPORT',
      symbol: 'org.apache.commons.text.StringSubstitutor',
      dependencyPurl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      sourceSet: 'MAIN',
      vulnerableApi: false,
      evidence: {
        location: { filePath: 'src/main/java/com/example/demo/TemplateService.java', line: 3 },
        snippet: 'import org.apache.commons.text.StringSubstitutor;',
      },
    },
    {
      kind: 'METHOD_CALL',
      symbol: 'org.apache.commons.text.StringSubstitutor#createInterpolator',
      dependencyPurl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      sourceSet: 'MAIN',
      vulnerableApi: true,
      evidence: {
        location: { filePath: 'src/main/java/com/example/demo/TemplateService.java', line: 14 },
        snippet: 'StringSubstitutor.createInterpolator()',
      },
    },
    {
      kind: 'IMPORT',
      symbol: 'org.apache.commons.text.StringSubstitutor',
      dependencyPurl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      sourceSet: 'TEST',
      vulnerableApi: false,
      evidence: {
        location: { filePath: 'src/test/java/com/example/demo/TemplateServiceTest.java', line: 5 },
        snippet: 'import org.apache.commons.text.StringSubstitutor;',
      },
    },
  ],
};

const usageReport: ScanReport = {
  ...baseReport,
  stages: baseReport.stages.map((s) => (s.stage === 'SOURCE_USAGE' ? { stage: s.stage, status: 'SUCCEEDED' } : s)),
  sourceAnalysis: { mainFiles: 3, testFiles: 1, skippedFiles: [], usedDependencies: 1 },
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
        'Used by source:    unavailable (SKIPPED — not implemented (Phase 4))',
      ].join('\n'),
    );
  });

  it('prints the used-by-source count once SOURCE_USAGE succeeded', () => {
    const report: ScanReport = { ...usageReport, findings: [{ ...finding, usage: usedUsage }] };
    expect(renderSummary(report)).toContain('Used by source:    1');
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
        'ID              Severity  CVSS  Dependency                           Used  Vuln API  Fixed',
        'CVE-2022-42889  CRITICAL  9.8   org.apache.commons:commons-text@1.9  -     -         1.10.0',
      ].join('\n'),
    );
  });

  it('widens columns so long dependency names and API labels keep later columns aligned', () => {
    const longFinding: VulnerabilityFinding = {
      ...finding,
      vulnerability: { ...finding.vulnerability, id: 'GHSA-xxxx-yyyy-zzzz', aliases: [], severity: 'HIGH', cvssScore: 7.5 },
      package: { ...finding.package, name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.15.2' },
      fixedVersions: ['2.18.8'],
      usage: { ...usedUsage, used: false, vulnerableApi: 'NOT_DETECTED', usages: [] },
    };
    const report: ScanReport = { ...usageReport, findings: [{ ...finding, usage: usedUsage }, longFinding] };
    expect(renderVulnerabilityTable(report).split('\n')).toEqual([
      'ID                   Severity  CVSS  Dependency                                          Used  Vuln API      Fixed',
      'CVE-2022-42889       CRITICAL  9.8   org.apache.commons:commons-text@1.9                 yes   used          1.10.0',
      'GHSA-xxxx-yyyy-zzzz  HIGH      7.5   com.fasterxml.jackson.core:jackson-databind@2.15.2  no    not detected  2.18.8',
    ]);
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

describe('renderSourceUsage', () => {
  it('prints file:line evidence with vulnerable API and test markers', () => {
    const report: ScanReport = { ...usageReport, findings: [{ ...finding, usage: usedUsage }] };
    expect(renderSourceUsage(report)).toBe(
      [
        'Source usage: 4 Java files analyzed (3 main, 1 test)',
        '',
        'CVE-2022-42889  org.apache.commons:commons-text@1.9  used, vulnerable API used',
        '  packages: org.apache.commons.text (curated mapping)',
        '  vulnerable APIs checked: org.apache.commons.text.StringSubstitutor#createInterpolator',
        '  src/main/java/com/example/demo/TemplateService.java:3      IMPORT       org.apache.commons.text.StringSubstitutor',
        '  src/main/java/com/example/demo/TemplateService.java:14     METHOD_CALL  org.apache.commons.text.StringSubstitutor#createInterpolator  [vulnerable API]',
        '  src/test/java/com/example/demo/TemplateServiceTest.java:5  IMPORT       org.apache.commons.text.StringSubstitutor  [test]',
      ].join('\n'),
    );
  });

  it('reports unavailable when SOURCE_USAGE did not succeed', () => {
    const report: ScanReport = { ...baseReport, findings: [finding] };
    expect(renderSourceUsage(report)).toBe('Source usage: unavailable (SKIPPED — not implemented (Phase 4))');
  });
});
