import type { AffectedRange, FindingUsage, ProjectDependency, VulnerabilityFinding } from '@vulntrace/shared';
import { describe, expect, it } from 'vitest';
import { planRemediation } from './planRemediation.js';

const range = (introduced: string, fixed?: string): AffectedRange => ({
  type: 'ECOSYSTEM',
  events: [{ introduced }, ...(fixed ? [{ fixed }] : [])],
});

function finding(
  id: string,
  name: string,
  version: string,
  ranges: AffectedRange[],
  extra: Partial<VulnerabilityFinding> = {},
): VulnerabilityFinding {
  const fixedVersions = ranges.flatMap((r) => r.events.flatMap((e) => (e.fixed ? [e.fixed] : [])));
  return {
    vulnerability: {
      id,
      aliases: [],
      summary: id,
      severity: 'HIGH',
      severitySource: 'DATABASE_SPECIFIC',
      modified: '2024-01-01T00:00:00Z',
      references: [],
    },
    package: { ecosystem: 'Maven', name, version, purl: `pkg:maven/${name.replace(':', '/')}@${version}` },
    fixedVersions,
    evidence: { provider: 'OSV', queriedAt: '2024-01-01T00:00:00Z', affectedRanges: ranges, affectedVersions: [] },
    ...extra,
  };
}

const dependency = (name: string, version: string, direct: boolean, introducedBy?: string[]): ProjectDependency => {
  const [groupId = '', artifactId = ''] = name.split(':');
  return {
    coordinate: { groupId, artifactId, version, scope: 'compile', direct, purl: `pkg:maven/${groupId}/${artifactId}@${version}` },
    source: { kind: direct ? 'pom.xml' : 'dependency-tree', filePath: '/abs/path/pom.xml', ...(introducedBy ? { introducedBy } : {}) },
  };
};

const usage = (used: boolean): FindingUsage => ({
  used,
  vulnerableApi: used ? 'USED' : 'NOT_DETECTED',
  packageMapping: { packages: ['x'], basis: 'CURATED' },
  vulnerableApis: [],
  usages: used
    ? [
        {
          kind: 'METHOD_CALL',
          symbol: 'x.Y#z',
          dependencyPurl: '',
          sourceSet: 'MAIN',
          vulnerableApi: true,
          evidence: { location: { filePath: 'src/main/java/A.java', line: 14 }, snippet: '' },
        },
      ]
    : [],
});

const risk = (score: number) => ({ score, reasons: [], rulesVersion: 'test' });

describe('planRemediation', () => {
  it('picks the lowest fixed version that settles every finding across release lines (jackson-style)', () => {
    const name = 'com.fasterxml.jackson.core:jackson-databind';
    const findings = [
      finding('A', name, '2.9.8', [range('2.9.0', '2.9.10.4')]),
      finding('B', name, '2.9.8', [range('2.6.0', '2.6.7.4'), range('2.7.0.0', '2.9.10.7'), range('2.10.0.0', '2.10.5.1')]),
      finding('C', name, '2.9.8', [range('2.13.0', '2.13.2.1'), range('0', '2.12.6.1')]),
    ];
    const [plan] = planRemediation({
      findings: findings.map((f) => ({ finding: f })),
      dependencies: [dependency(name, '2.9.8', true)],
    });
    // 2.9.10.4 and 2.9.10.7 still leave C affected; 2.10.5.1 is inside C's `0 → 2.12.6.1` range.
    expect(plan?.recommendedVersion).toBe('2.12.6.1');
    expect(plan?.fixedCount).toBe(3);
    expect(plan?.majorUpgrade).toBe(false);
    expect(plan?.findings.find((f) => f.vulnerabilityId === 'B')?.fixedVersions).toEqual(['2.6.7.4', '2.9.10.7', '2.10.5.1']);
    expect(plan?.actions).toEqual([
      {
        kind: 'UPGRADE_DIRECT',
        description: `Change <version> of ${name} from 2.9.8 to 2.12.6.1 in pom.xml (fixes 3 of 3 findings).`,
      },
    ]);
  });

  it('flags a major upgrade and keeps the evidence of reach and usage', () => {
    const name = 'org.yaml:snakeyaml';
    const reached = finding('Y', name, '1.21', [range('0', '2.0')], {
      usage: usage(true),
      risk: risk(73),
      reachability: {
        status: 'REACHABLE',
        reachable: true,
        totalPaths: 1,
        truncated: false,
        scope: { endpointCount: 1, visitedMethodCount: 1, unresolvedCallCount: 0, unsupported: [] },
        paths: [
          {
            endpoint: {
              httpMethod: 'GET',
              path: '/rce/vuln/yarm',
              controllerClass: 'Rce',
              controllerMethod: 'yarm',
              location: { filePath: 'Rce.java', line: 1 },
              unresolved: [],
              evidence: {
                controller: { annotation: '@RestController', location: { filePath: 'Rce.java', line: 1 } },
                methodMapping: { annotation: '@GetMapping', location: { filePath: 'Rce.java', line: 1 } },
              },
            },
            steps: [{ method: { className: 'org.joychou.controller.Rce', methodName: 'yarm' } }],
            usage: usage(true).usages[0]!,
            sinkAttribution: 'METHOD',
          },
        ],
      },
    });
    const [plan] = planRemediation({ findings: [{ id: 'f1', finding: reached }], dependencies: [dependency(name, '1.21', true)] });
    expect(plan).toMatchObject({
      recommendedVersion: '2.0',
      majorUpgrade: true,
      maxRiskScore: 73,
      reachableEndpoints: ['GET /rce/vuln/yarm'],
      affectedFiles: ['src/main/java/A.java:14'],
      affectedMethods: ['org.joychou.controller.Rce#yarm'],
      dependency: { declaredIn: 'pom.xml', direct: true },
    });
    expect(plan?.findings[0]).toMatchObject({ findingId: 'f1', status: 'FIXED' });
    expect(plan?.actions[0]?.description).toContain('Major version change');
  });

  it('reports findings without a fix, and partial fixes', () => {
    const name = 'org.example:lib';
    const plan = planRemediation({
      findings: [
        { finding: finding('FIXABLE', name, '1.0', [range('0', '1.2')]) },
        { finding: finding('NOFIX', name, '1.0', [range('0')]) },
      ],
      dependencies: [dependency(name, '1.0', true)],
    })[0];
    expect(plan?.recommendedVersion).toBe('1.2');
    expect(plan?.findings.map((f) => [f.vulnerabilityId, f.status])).toEqual([
      ['FIXABLE', 'FIXED'],
      ['NOFIX', 'NO_FIX'],
    ]);
    expect(plan?.actions.map((a) => a.kind)).toEqual(['UPGRADE_DIRECT', 'NO_FIX']);

    const none = planRemediation({
      findings: [{ finding: finding('NOFIX', name, '1.0', [range('0')]) }],
      dependencies: [dependency(name, '1.0', true)],
    })[0];
    expect(none?.recommendedVersion).toBeUndefined();
    expect(none?.actions.map((a) => a.kind)).toEqual(['NO_FIX']);
  });

  it('pins transitive dependencies through dependencyManagement and suggests removing unused direct ones', () => {
    const name = 'org.example:inner';
    const [transitive] = planRemediation({
      findings: [{ finding: finding('T', name, '1.0', [range('0', '1.1')]) }],
      dependencies: [dependency(name, '1.0', false, ['pkg:maven/org.example/outer@3.0'])],
    });
    expect(transitive?.actions[0]?.kind).toBe('OVERRIDE_TRANSITIVE');
    expect(transitive?.actions[0]?.description).toContain('<dependencyManagement>');
    expect(transitive?.actions[0]?.description).toContain('pkg:maven/org.example/outer@3.0');

    const [unused] = planRemediation({
      findings: [{ finding: finding('U', name, '1.0', [range('0', '1.1')], { usage: usage(false) }) }],
      dependencies: [dependency(name, '1.0', true)],
    });
    expect(unused?.actions.map((a) => a.kind)).toEqual(['UPGRADE_DIRECT', 'REVIEW_UNUSED']);
  });

  it('groups by dependency and sorts by highest risk', () => {
    const plan = planRemediation({
      findings: [
        { finding: finding('LOW', 'a:low', '1', [range('0', '2')], { risk: risk(20) }) },
        { finding: finding('HIGH', 'b:high', '1', [range('0', '2')], { risk: risk(80) }) },
        { finding: finding('HIGH2', 'b:high', '1', [range('0', '3')], { risk: risk(40) }) },
      ],
      dependencies: [],
    });
    expect(plan.map((p) => [p.dependency.name, p.findings.length, p.maxRiskScore, p.recommendedVersion])).toEqual([
      ['b:high', 2, 80, '3'],
      ['a:low', 1, 20, '2'],
    ]);
  });
});
