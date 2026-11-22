import type {
  AuthenticationStatus,
  ProjectDependency,
  ReachabilityResult,
  RiskReason,
  RiskScore,
  UnresolvedDependency,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import { RULES, RULES_VERSION, SCORE_MAX, SCORE_MIN } from './rules.js';

/** Project-level facts shared by every finding of one scan. */
export interface RiskContext {
  dependencies: readonly ProjectDependency[];
  /** Dependencies Phase 1 could not version-resolve; still evidence that a library is declared. */
  unresolvedDependencies: readonly UnresolvedDependency[];
  /** Why source usage is missing on findings, e.g. `SKIPPED — ...`; undefined when the stage succeeded. */
  sourceUsageNote?: string;
  /** Why reachability is missing on findings; undefined when the stage succeeded. */
  reachabilityNote?: string;
}

const SPRING_SECURITY_GROUP = 'org.springframework.security';
const SPRING_SECURITY_STARTER = 'spring-boot-starter-security';

/** True when any declared or resolved dependency belongs to Spring Security. */
export function hasSpringSecurity(context: Pick<RiskContext, 'dependencies' | 'unresolvedDependencies'>): boolean {
  const coordinates = [
    ...context.dependencies.map((d) => ({ groupId: d.coordinate.groupId, artifactId: d.coordinate.artifactId })),
    ...context.unresolvedDependencies.map((d) => ({ groupId: d.groupId, artifactId: d.artifactId })),
  ];
  return coordinates.some((c) => c.groupId === SPRING_SECURITY_GROUP || c.artifactId === SPRING_SECURITY_STARTER);
}

/**
 * Phase 7 D4: authentication in front of the reaching endpoints, as far as static analysis can tell.
 * REQUIRED only when every path starts at a handler with an access annotation (and none were cut off).
 */
export function assessAuthentication(
  reachability: ReachabilityResult,
  springSecurity: boolean,
): { status: AuthenticationStatus; evidence: string[] } {
  if (!springSecurity) return { status: 'NOT_REQUIRED', evidence: [] };
  const endpoints = reachability.paths.map((p) => p.endpoint);
  const protectedAll =
    endpoints.length > 0 && !reachability.truncated && endpoints.every((e) => (e.security?.length ?? 0) > 0);
  if (protectedAll) {
    const annotations = new Set(endpoints.flatMap((e) => (e.security ?? []).map((s) => s.annotation)));
    return { status: 'REQUIRED', evidence: [...annotations] };
  }
  const open = endpoints.filter((e) => (e.security?.length ?? 0) === 0).map((e) => `${e.httpMethod} ${e.path}`);
  return {
    status: 'UNKNOWN',
    evidence: [
      'Spring Security is present; URL rules (SecurityFilterChain) are not analyzed',
      ...(open.length > 0 ? [`no access annotation on: ${unique(open).join(', ')}`] : []),
    ],
  };
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * Phase 7 — pure, deterministic, explainable scoring (CLAUDE.md §6.3, §8). Every factor yields one
 * reason, and the reasons' weights sum to the score before clamping to 0–100.
 */
export class RiskScoreCalculator {
  calculate(finding: VulnerabilityFinding, context: RiskContext): RiskScore {
    const reasons: RiskReason[] = [
      severityReason(finding),
      usageReason(finding, context),
      directReason(finding, context),
      ...exposureReasons(finding, context),
      exploitReason(finding),
      fixReason(finding),
    ];
    const total = reasons.reduce((sum, r) => sum + r.weight, 0);
    return {
      score: Math.min(SCORE_MAX, Math.max(SCORE_MIN, total)),
      reasons,
      rulesVersion: RULES_VERSION,
    };
  }
}

function severityReason({ vulnerability }: VulnerabilityFinding): RiskReason {
  if (vulnerability.cvssScore !== undefined) {
    return {
      factor: 'CVSS_SEVERITY',
      status: 'APPLIED',
      weight: Math.round(vulnerability.cvssScore * RULES.cvssMultiplier),
      description: `CVSS v3 ${vulnerability.cvssScore.toFixed(1)} (${vulnerability.severity})`,
      ...(vulnerability.cvssVector ? { evidence: [vulnerability.cvssVector] } : {}),
    };
  }
  return {
    factor: 'CVSS_SEVERITY',
    status: 'APPLIED',
    weight: RULES.severityFallback[vulnerability.severity],
    description: `severity ${vulnerability.severity} (no CVSS v3 score; ${vulnerability.severitySource === 'NONE' ? 'no severity data' : 'label from the advisory'})`,
  };
}

/** The highest usage step reached: not used / used / vulnerable API used / reachable. */
function usageReason(finding: VulnerabilityFinding, context: RiskContext): RiskReason {
  const { usage, reachability } = finding;
  if (!usage) {
    return {
      factor: 'SOURCE_USAGE',
      status: 'NOT_ANALYZED',
      weight: 0,
      description: `source usage not analyzed${context.sourceUsageNote ? ` (${context.sourceUsageNote})` : ''}`,
    };
  }
  if (reachability?.reachable) {
    const endpoints = unique(reachability.paths.map((p) => `${p.endpoint.httpMethod} ${p.endpoint.path}`));
    const listed = endpoints.slice(0, RULES.maxEndpointsListed);
    const more = reachability.totalPaths > listed.length ? [`… ${reachability.totalPaths} paths in total`] : [];
    return {
      factor: 'REACHABLE',
      status: 'APPLIED',
      weight: RULES.usage.reachable,
      description: `vulnerable API reachable from ${endpoints.length === 1 ? 'an HTTP endpoint' : `${endpoints.length} HTTP endpoints`}`,
      evidence: [...listed, ...more],
    };
  }
  if (usage.vulnerableApi === 'USED') {
    const reachabilityNote = !reachability
      ? `; reachability not analyzed${context.reachabilityNote ? ` (${context.reachabilityNote})` : ''}`
      : '; no call path from an endpoint found (not proof of absence)';
    return {
      factor: 'VULNERABLE_API_USAGE',
      status: 'APPLIED',
      weight: RULES.usage.vulnerableApiUsed,
      description: `vulnerable API called from main source${reachabilityNote}`,
    };
  }
  if (usage.used) {
    return {
      factor: 'SOURCE_USAGE',
      status: 'APPLIED',
      weight: RULES.usage.used,
      description:
        usage.vulnerableApi === 'NO_API_INFO'
          ? 'dependency used by main source (no vulnerable-API information to narrow it down)'
          : 'dependency used by main source, but no known vulnerable API call found',
    };
  }
  return {
    factor: 'SOURCE_USAGE',
    status: 'APPLIED',
    weight: RULES.usage.notUsed,
    description: 'dependency not used by main source',
  };
}

function directReason(finding: VulnerabilityFinding, context: RiskContext): RiskReason {
  const dependency = context.dependencies.find((d) => d.coordinate.purl === finding.package.purl);
  if (!dependency) {
    return { factor: 'DIRECT_DEPENDENCY', status: 'NOT_ANALYZED', weight: 0, description: 'dependency not found in scan' };
  }
  if (!dependency.coordinate.direct) {
    const via = dependency.source.introducedBy?.length ? ` via ${dependency.source.introducedBy.join(' → ')}` : '';
    return { factor: 'DIRECT_DEPENDENCY', status: 'APPLIED', weight: 0, description: `transitive dependency${via}` };
  }
  return {
    factor: 'DIRECT_DEPENDENCY',
    status: 'APPLIED',
    weight: RULES.directDependency,
    // File name only: a local scan's absolute path says nothing useful and should not be stored as a reason.
    description: `direct dependency declared in ${dependency.source.filePath.split(/[\\/]/).pop() || 'pom.xml'}`,
  };
}

/** Authentication only matters once a request can reach the vulnerable call. */
function exposureReasons(finding: VulnerabilityFinding, context: RiskContext): RiskReason[] {
  const reachability = finding.reachability;
  if (!reachability?.reachable) return [];
  const auth = assessAuthentication(reachability, hasSpringSecurity(context));
  const weight =
    auth.status === 'NOT_REQUIRED'
      ? RULES.authentication.notRequired
      : auth.status === 'REQUIRED'
        ? RULES.authentication.required
        : RULES.authentication.unknown;
  const description =
    auth.status === 'NOT_REQUIRED'
      ? 'no authentication: the project has no Spring Security dependency'
      : auth.status === 'REQUIRED'
        ? 'every reaching endpoint requires an authenticated caller'
        : 'authentication unknown';
  return [
    {
      factor: 'AUTHENTICATION_REQUIRED',
      status: 'APPLIED',
      weight,
      description,
      ...(auth.evidence.length > 0 ? { evidence: auth.evidence } : {}),
    },
  ];
}

function exploitReason({ vulnerability }: VulnerabilityFinding): RiskReason {
  if (vulnerability.evidenceReferences === undefined) {
    return {
      factor: 'KNOWN_EXPLOIT',
      status: 'NOT_ANALYZED',
      weight: 0,
      description: 'exploit evidence not recorded for this scan (scanned before Phase 7)',
    };
  }
  if (vulnerability.evidenceReferences.length > 0) {
    return {
      factor: 'KNOWN_EXPLOIT',
      status: 'APPLIED',
      weight: RULES.knownExploit,
      description: 'OSV lists evidence demonstrating the vulnerability',
      evidence: vulnerability.evidenceReferences,
    };
  }
  return {
    factor: 'KNOWN_EXPLOIT',
    status: 'APPLIED',
    weight: 0,
    description: 'no exploit evidence in OSV (not proof that none exists)',
  };
}

function fixReason({ fixedVersions }: VulnerabilityFinding): RiskReason {
  return fixedVersions.length > 0
    ? {
        factor: 'FIX_AVAILABLE',
        status: 'APPLIED',
        weight: RULES.fixAvailable,
        description: `fixed in ${fixedVersions.join(', ')}`,
      }
    : { factor: 'FIX_AVAILABLE', status: 'APPLIED', weight: 0, description: 'no fixed version published' };
}
