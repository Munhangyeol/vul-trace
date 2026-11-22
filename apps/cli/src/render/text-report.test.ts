import { describe, expect, it } from 'vitest';
import type { ScanReport } from '@vulntrace/core';
import type { FindingUsage, VulnerabilityFinding } from '@vulntrace/shared';
import {
  renderDependencies,
  renderEndpoints,
  renderReachability,
  renderRisk,
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
  endpoints: [],
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
        'Endpoints:         unavailable (SKIPPED — not implemented (Phase 5))',
        'Reachable:         unavailable (SKIPPED — not implemented (Phase 6))',
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
        'ID              Risk  Severity  CVSS  Dependency                           Used  Vuln API  Reachable  Fixed',
        'CVE-2022-42889  -     CRITICAL  9.8   org.apache.commons:commons-text@1.9  -     -         -          1.10.0',
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
      'ID                   Risk  Severity  CVSS  Dependency                                          Used  Vuln API      Reachable  Fixed',
      'CVE-2022-42889       -     CRITICAL  9.8   org.apache.commons:commons-text@1.9                 yes   used          -          1.10.0',
      'GHSA-xxxx-yyyy-zzzz  -     HIGH      7.5   com.fasterxml.jackson.core:jackson-databind@2.15.2  no    not detected  -          2.18.8',
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

describe('renderSummary for GitHub repository scans', () => {
  it('prints the repository, ref and analyzed commit', () => {
    const text = renderSummary({
      ...baseReport,
      projectPath: 'https://github.com/example/demo',
      source: {
        type: 'GIT',
        repoUrl: 'https://github.com/example/demo',
        ref: 'main',
        commitSha: 'f'.repeat(40),
      },
    });
    expect(text.split('\n').slice(0, 3)).toEqual([
      'Project: demo',
      `Source:  https://github.com/example/demo (main) @ ${'f'.repeat(40)}`,
      'State:   COMPLETED',
    ]);
  });

  it('shows the fetch failure reason instead of the skipped detection stage', () => {
    const text = renderSummary({
      ...baseReport,
      projectPath: 'https://github.com/example/missing',
      state: 'FAILED',
      source: { type: 'GIT', repoUrl: 'https://github.com/example/missing' },
      stages: [
        {
          stage: 'REPOSITORY_FETCH',
          status: 'FAILED',
          reason: 'CLONE_FAILED: repository not found',
        },
        { stage: 'PROJECT_DETECTION', status: 'SKIPPED', reason: 'repository not fetched' },
      ],
      dependencies: [],
    });
    expect(text).toContain('Source:  https://github.com/example/missing @ not fetched');
    expect(text).toContain(
      'Dependencies: unavailable (FAILED — CLONE_FAILED: repository not found)',
    );
  });
});

describe('findings used through an implemented API', () => {
  const viaApi = {
    path: ['pkg:maven/org.apache.logging.log4j/log4j-api@2.9.1'],
    reason: 'log4j-core implements log4j-api',
  };
  const report: ScanReport = {
    ...baseReport,
    stages: baseReport.stages.map((s) =>
      s.stage === 'SOURCE_USAGE' ? { stage: 'SOURCE_USAGE', status: 'SUCCEEDED' } : s,
    ),
    sourceAnalysis: { mainFiles: 1, testFiles: 0, skippedFiles: [], usedDependencies: 1 },
    findings: [{ ...finding, usage: { ...usedUsage, viaApi } }],
  };

  it('marks the Used column "via API"', () => {
    expect(renderVulnerabilityTable(report)).toMatch(/via API/);
  });

  it('prints the chain in the source usage section', () => {
    const text = renderSourceUsage(report);
    expect(text).toContain('used via API');
    expect(text).toContain(
      'used through: pkg:maven/org.apache.logging.log4j/log4j-api@2.9.1 (log4j-core implements log4j-api)',
    );
  });
});

describe('renderEndpoints', () => {
  const springReport: ScanReport = {
    ...baseReport,
    stages: baseReport.stages.map((s) =>
      s.stage === 'SPRING_ENDPOINT' ? { stage: s.stage, status: 'SUCCEEDED' } : s,
    ),
    endpoints: [
      {
        httpMethod: 'POST',
        path: '/api/templates/render',
        controllerClass: 'com.example.demo.TemplateController',
        controllerMethod: 'render',
        location: { filePath: 'src/main/java/com/example/demo/TemplateController.java', line: 19 },
        unresolved: [],
        evidence: {
          controller: { annotation: '@RestController', location: { filePath: 'T.java', line: 8 } },
          methodMapping: { annotation: '@PostMapping("/render")', location: { filePath: 'T.java', line: 18 } },
        },
      },
      {
        httpMethod: 'ANY',
        path: '/${Paths.USERS}',
        controllerClass: 'com.example.demo.UserController',
        controllerMethod: 'all',
        location: { filePath: 'src/main/java/com/example/demo/UserController.java', line: 7 },
        unresolved: ['Paths.USERS'],
        evidence: {
          controller: { annotation: '@Controller', location: { filePath: 'U.java', line: 3 } },
          methodMapping: { annotation: '@RequestMapping(Paths.USERS)', location: { filePath: 'U.java', line: 6 } },
        },
      },
    ],
  };

  it('lists each endpoint with its handler and notes unresolved parts', () => {
    expect(renderEndpoints(springReport)).toBe(
      [
        'Spring endpoints: 2',
        '  POST  /api/templates/render  com.example.demo.TemplateController#render  src/main/java/com/example/demo/TemplateController.java:19',
        '  ANY   /${Paths.USERS}        com.example.demo.UserController#all         src/main/java/com/example/demo/UserController.java:7',
        '    unresolved: Paths.USERS',
      ].join('\n'),
    );
    expect(renderSummary(springReport)).toContain('Endpoints:         2');
  });

  it('says unavailable, not 0, when the stage did not run', () => {
    expect(renderEndpoints(baseReport)).toBe(
      'Spring endpoints: unavailable (SKIPPED — not implemented (Phase 5))',
    );
  });
});

describe('renderReachability', () => {
  const handler = 'src/main/java/com/example/demo/TemplateController.java';
  const service = 'src/main/java/com/example/demo/TemplateService.java';
  const usage = usedUsage.usages.find((u) => u.vulnerableApi) ?? usedUsage.usages[0]!;
  const scope = { endpointCount: 2, visitedMethodCount: 3, unresolvedCallCount: 1, unsupported: [] };
  const reachableReport: ScanReport = {
    ...usageReport,
    stages: usageReport.stages.map((s) => (s.stage === 'REACHABILITY' ? { stage: s.stage, status: 'SUCCEEDED' } : s)),
    callGraph: { methodCount: 8, edgeCount: 1, unresolvedCallCount: 1 },
    findings: [
      {
        ...finding,
        usage: usedUsage,
        reachability: {
          status: 'REACHABLE',
          reachable: true,
          totalPaths: 1,
          truncated: false,
          scope,
          paths: [
            {
              endpoint: {
                httpMethod: 'POST',
                path: '/api/templates/render',
                controllerClass: 'com.example.demo.TemplateController',
                controllerMethod: 'render',
                location: { filePath: handler, line: 19 },
                unresolved: [],
                evidence: {
                  controller: { annotation: '@RestController', location: { filePath: handler, line: 8 } },
                  methodMapping: { annotation: '@PostMapping("/render")', location: { filePath: handler, line: 18 } },
                },
              },
              usage,
              sinkAttribution: 'METHOD',
              steps: [
                {
                  method: { className: 'com.example.demo.TemplateController', methodName: 'render' },
                  callSite: { filePath: handler, line: 20 },
                  callSnippet: 'return templateService.render(template);',
                },
                {
                  method: { className: 'com.example.demo.TemplateService', methodName: 'render' },
                  callSite: { filePath: service, line: 14 },
                  callSnippet: 'StringSubstitutor.createInterpolator();',
                  basis: 'INTERFACE_DISPATCH',
                },
              ],
            },
          ],
        },
      },
    ],
  };

  it('prints each path from the endpoint to the vulnerable call with call sites', () => {
    expect(renderReachability(reachableReport).split('\n')).toEqual([
      'Reachability: call graph of 8 methods, 1 calls, 1 unresolved',
      '',
      'CVE-2022-42889  org.apache.commons:commons-text@1.9  reachable, 1 path(s)',
      '  POST /api/templates/render',
      '    -> com.example.demo.TemplateController#render',
      `         ${handler}:20  return templateService.render(template);`,
      '    -> com.example.demo.TemplateService#render  [interface dispatch]',
      `         ${service}:14  StringSubstitutor.createInterpolator();`,
      `    => ${usage.symbol}`,
    ]);
    expect(renderVulnerabilityTable(reachableReport)).toContain('  yes        1.10.0');
    expect(renderSummary(reachableReport)).toContain('Reachable:         1');
  });

  it('says what was searched when no path was found', () => {
    const report: ScanReport = {
      ...reachableReport,
      findings: [
        {
          ...finding,
          usage: usedUsage,
          reachability: {
            status: 'NOT_REACHABLE',
            reachable: false,
            reason: 'no call path from any endpoint',
            paths: [],
            totalPaths: 0,
            truncated: false,
            scope,
          },
        },
      ],
    };
    expect(renderReachability(report)).toContain(
      'CVE-2022-42889  org.apache.commons:commons-text@1.9  not reachable (no call path from any endpoint)',
    );
    expect(renderReachability(report)).toContain('1 calls could not be resolved — not proof of absence');
    expect(renderVulnerabilityTable(report)).toContain('  no path    1.10.0');
  });

  it('says unavailable when the stage did not run', () => {
    expect(renderReachability(baseReport)).toBe('Reachability: unavailable (SKIPPED — not implemented (Phase 6))');
  });
});

describe('renderRisk', () => {
  const scoredReport: ScanReport = {
    ...baseReport,
    stages: baseReport.stages.map((s) => (s.stage === 'RISK' ? { stage: s.stage, status: 'SUCCEEDED' } : s)),
    findings: [
      {
        ...finding,
        risk: {
          score: 44,
          rulesVersion: 'r1',
          reasons: [
            { factor: 'CVSS_SEVERITY', status: 'APPLIED', weight: 39, description: 'CVSS v3 9.8 (CRITICAL)' },
            { factor: 'SOURCE_USAGE', status: 'NOT_ANALYZED', weight: 0, description: 'source usage not analyzed' },
            { factor: 'DIRECT_DEPENDENCY', status: 'APPLIED', weight: 5, description: 'direct dependency declared in pom.xml' },
            { factor: 'KNOWN_EXPLOIT', status: 'APPLIED', weight: 0, description: 'no exploit evidence in OSV', evidence: ['x'] },
          ],
        },
      },
    ],
  };

  it('lists each reason with its signed weight, ? for what was not analyzed', () => {
    expect(renderRisk(scoredReport).split('\n')).toEqual([
      'Risk: 1 findings scored (rules r1), highest first',
      '',
      'CVE-2022-42889  org.apache.commons:commons-text@1.9  risk 44',
      '   +39  CVSS v3 9.8 (CRITICAL)',
      '     ?  source usage not analyzed',
      '    +5  direct dependency declared in pom.xml',
      '     0  no exploit evidence in OSV  [x]',
    ]);
    expect(renderVulnerabilityTable(scoredReport)).toContain('CVE-2022-42889  44    CRITICAL');
  });

  it('says unavailable when the stage did not run', () => {
    expect(renderRisk(baseReport)).toBe('Risk: unavailable (SKIPPED — not implemented (Phase 7))');
  });
});
