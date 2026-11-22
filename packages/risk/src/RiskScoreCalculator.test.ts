import type {
  FindingUsage,
  ProjectDependency,
  ReachabilityResult,
  SpringEndpoint,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import { describe, expect, it } from 'vitest';
import { assessAuthentication, hasSpringSecurity, RiskScoreCalculator } from './RiskScoreCalculator.js';
import type { RiskContext } from './RiskScoreCalculator.js';
import { RULES_VERSION } from './rules.js';

const PURL = 'pkg:maven/org.apache.commons/commons-text@1.9';

const finding = (overrides: Partial<VulnerabilityFinding> = {}): VulnerabilityFinding => ({
  vulnerability: {
    id: 'GHSA-599f-7c49-w659',
    aliases: ['CVE-2022-42889'],
    summary: 'Text4Shell',
    severity: 'CRITICAL',
    severitySource: 'CVSS_V3',
    cvssScore: 9.8,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    modified: '2024-01-01T00:00:00Z',
    references: [],
    evidenceReferences: [],
  },
  package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl: PURL },
  fixedVersions: ['1.10.0'],
  evidence: { provider: 'OSV', queriedAt: '2026-11-22T00:00:00Z', affectedRanges: [], affectedVersions: [] },
  ...overrides,
});

const dependency = (direct: boolean, groupId = 'org.apache.commons', artifactId = 'commons-text'): ProjectDependency => ({
  coordinate: { groupId, artifactId, version: '1.9', scope: 'compile', direct, purl: direct ? PURL : `${PURL}-t` },
  source: { kind: 'pom.xml', filePath: 'pom.xml' },
});

const context = (overrides: Partial<RiskContext> = {}): RiskContext => ({
  dependencies: [dependency(true)],
  unresolvedDependencies: [],
  ...overrides,
});

const usage = (used: boolean, vulnerableApi: FindingUsage['vulnerableApi']): FindingUsage => ({
  used,
  vulnerableApi,
  packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
  vulnerableApis: [],
  usages: [],
});

const endpoint = (path: string, security: string[] = []): SpringEndpoint => ({
  httpMethod: 'POST',
  path,
  controllerClass: 'C',
  controllerMethod: 'm',
  location: { filePath: 'C.java', line: 1 },
  unresolved: [],
  evidence: {
    controller: { annotation: '@RestController', location: { filePath: 'C.java', line: 1 } },
    methodMapping: { annotation: '@PostMapping', location: { filePath: 'C.java', line: 1 } },
  },
  security: security.map((annotation) => ({ annotation, location: { filePath: 'C.java', line: 1 } })),
});

const reachable = (...endpoints: SpringEndpoint[]): ReachabilityResult => ({
  status: 'REACHABLE',
  reachable: true,
  totalPaths: endpoints.length,
  truncated: false,
  scope: { endpointCount: endpoints.length, visitedMethodCount: 2, unresolvedCallCount: 0, unsupported: [] },
  paths: endpoints.map((e) => ({
    endpoint: e,
    steps: [],
    usage: {
      kind: 'METHOD_CALL',
      symbol: 'S#m',
      dependencyPurl: PURL,
      sourceSet: 'MAIN',
      vulnerableApi: true,
      evidence: { location: { filePath: 'S.java', line: 3 }, snippet: '' },
    },
    sinkAttribution: 'METHOD',
  })),
});

const notReachable: ReachabilityResult = { ...reachable(), status: 'NOT_REACHABLE', reachable: false };

const calculator = new RiskScoreCalculator();
const weights = (score: ReturnType<RiskScoreCalculator['calculate']>) =>
  Object.fromEntries(score.reasons.map((r) => [r.factor, r.weight]));

describe('RiskScoreCalculator', () => {
  it('scores the three fixture cases in the planned order (reachable > used > unused)', () => {
    const reachableScore = calculator.calculate(
      finding({ usage: usage(true, 'USED'), reachability: reachable(endpoint('/api/templates/render')) }),
      context(),
    );
    const usedScore = calculator.calculate(
      finding({ usage: usage(true, 'USED'), reachability: notReachable }),
      context(),
    );
    const unusedScore = calculator.calculate(
      finding({ usage: usage(false, 'NOT_DETECTED'), reachability: { ...notReachable, status: 'NO_VULNERABLE_API_USAGE' } }),
      context(),
    );
    expect([reachableScore.score, usedScore.score, unusedScore.score]).toEqual([89, 64, 44]);
    expect(weights(reachableScore)).toEqual({
      CVSS_SEVERITY: 39,
      REACHABLE: 35,
      DIRECT_DEPENDENCY: 5,
      AUTHENTICATION_REQUIRED: 10,
      KNOWN_EXPLOIT: 0,
      FIX_AVAILABLE: 0,
    });
    expect(reachableScore.reasons.find((r) => r.factor === 'REACHABLE')?.evidence).toEqual(['POST /api/templates/render']);
    expect(reachableScore.rulesVersion).toBe(RULES_VERSION);
  });

  it('always sums reasons to the score, and the same input gives the same output', () => {
    const input = finding({ usage: usage(true, 'USED'), reachability: reachable(endpoint('/a'), endpoint('/b')) });
    const first = calculator.calculate(input, context());
    expect(first.reasons.reduce((s, r) => s + r.weight, 0)).toBe(first.score);
    expect(calculator.calculate(input, context())).toEqual(first);
  });

  it('ranks a reachable MEDIUM above an unused CRITICAL', () => {
    const medium = finding({
      vulnerability: { ...finding().vulnerability, severity: 'MEDIUM', cvssScore: 5.3 },
      usage: usage(true, 'USED'),
      reachability: reachable(endpoint('/x')),
    });
    const critical = finding({ usage: usage(false, 'NOT_DETECTED') });
    expect(calculator.calculate(medium, context()).score).toBeGreaterThan(calculator.calculate(critical, context()).score);
  });

  it('falls back to the severity label without CVSS, and marks missing analysis as NOT_ANALYZED', () => {
    const score = calculator.calculate(
      finding({
        vulnerability: { ...finding().vulnerability, cvssScore: undefined, severity: 'HIGH', severitySource: 'DATABASE_SPECIFIC' },
      }),
      context({ sourceUsageNote: 'SKIPPED — maven' }),
    );
    expect(score.reasons[0]).toMatchObject({ factor: 'CVSS_SEVERITY', weight: 28 });
    expect(score.reasons[1]).toMatchObject({
      factor: 'SOURCE_USAGE',
      status: 'NOT_ANALYZED',
      weight: 0,
      description: 'source usage not analyzed (SKIPPED — maven)',
    });
    expect(score.score).toBe(33);
  });

  it('gives nothing for a transitive dependency and records the path', () => {
    const transitive = dependency(false);
    transitive.coordinate.purl = PURL;
    transitive.source = { kind: 'dependency-tree', filePath: 'pom.xml', introducedBy: ['a:b:1'] };
    const score = calculator.calculate(finding(), context({ dependencies: [transitive] }));
    expect(score.reasons.find((r) => r.factor === 'DIRECT_DEPENDENCY')).toMatchObject({
      weight: 0,
      description: 'transitive dependency via a:b:1',
    });
  });

  it('adds OSV EVIDENCE references as exploit evidence, and says when the data predates Phase 7', () => {
    const withEvidence = finding({
      vulnerability: { ...finding().vulnerability, evidenceReferences: ['https://example.test/replay'] },
    });
    expect(calculator.calculate(withEvidence, context()).reasons.find((r) => r.factor === 'KNOWN_EXPLOIT')).toMatchObject({
      weight: 10,
      evidence: ['https://example.test/replay'],
    });
    const old = finding({ vulnerability: { ...finding().vulnerability, evidenceReferences: undefined } });
    expect(calculator.calculate(old, context()).reasons.find((r) => r.factor === 'KNOWN_EXPLOIT')?.status).toBe(
      'NOT_ANALYZED',
    );
  });

  it('clamps to 0–100', () => {
    const maxed = finding({
      vulnerability: { ...finding().vulnerability, cvssScore: 10, evidenceReferences: ['u'] },
      usage: usage(true, 'USED'),
      reachability: reachable(endpoint('/x')),
    });
    expect(calculator.calculate(maxed, context()).score).toBe(100);
  });
});

describe('authentication', () => {
  const security = dependency(true, 'org.springframework.boot', 'spring-boot-starter-security');

  it('is NOT_REQUIRED only without any Spring Security dependency, resolved or not', () => {
    expect(hasSpringSecurity(context())).toBe(false);
    expect(hasSpringSecurity(context({ dependencies: [security] }))).toBe(true);
    expect(
      hasSpringSecurity(
        context({
          unresolvedDependencies: [
            {
              groupId: 'org.springframework.security',
              artifactId: 'spring-security-web',
              scope: 'compile',
              reason: 'VERSION_MANAGED_BY_PARENT',
              source: { kind: 'pom.xml', filePath: 'pom.xml' },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is REQUIRED when every reaching endpoint has an access annotation, otherwise UNKNOWN', () => {
    expect(assessAuthentication(reachable(endpoint('/a', ['@PreAuthorize("hasRole(\'A\')")'])), true)).toMatchObject({
      status: 'REQUIRED',
    });
    const mixed = assessAuthentication(reachable(endpoint('/a', ['@Secured("X")']), endpoint('/b')), true);
    expect(mixed.status).toBe('UNKNOWN');
    expect(mixed.evidence).toContain('no access annotation on: POST /b');
    expect(
      assessAuthentication({ ...reachable(endpoint('/a', ['@Secured("X")'])), truncated: true }, true).status,
    ).toBe('UNKNOWN');
  });

  it('subtracts points when authentication is required', () => {
    const score = calculator.calculate(
      finding({ usage: usage(true, 'USED'), reachability: reachable(endpoint('/a', ['@Secured("X")'])) }),
      context({ dependencies: [dependency(true), security] }),
    );
    expect(score.reasons.find((r) => r.factor === 'AUTHENTICATION_REQUIRED')?.weight).toBe(-10);
    expect(score.score).toBe(69);
  });
});
