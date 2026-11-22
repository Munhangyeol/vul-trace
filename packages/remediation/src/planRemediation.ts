import type {
  DependencyRemediation,
  FindingFixStatus,
  FixStatus,
  ProjectDependency,
  RemediationAction,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import { isAffected } from './isAffected.js';
import { compareMavenVersions, majorVersion, parseMavenVersion } from './MavenVersion.js';
import type { MavenVersion } from './MavenVersion.js';

export interface RemediationFinding {
  /** Stored finding id, when available — carried through for linking. */
  id?: string;
  finding: VulnerabilityFinding;
}

export interface RemediationInput {
  findings: readonly RemediationFinding[];
  dependencies: readonly ProjectDependency[];
}

const BASIS =
  'Lowest fixed version listed by OSV above the current one that no known finding of this dependency affects. ' +
  'Newer releases may exist (Maven Central is not queried), and vulnerabilities not yet in OSV are not covered.';

/**
 * Phase 8 — one upgrade decision per vulnerable dependency, derived only from data the scan already
 * holds (OSV ranges, Phase 4 usages, Phase 6 paths, Phase 7 scores). Pure and deterministic (D7):
 * the same findings always give the same plan. Sorted by highest risk, then by finding count.
 */
export function planRemediation(input: RemediationInput): DependencyRemediation[] {
  const groups = new Map<string, RemediationFinding[]>();
  for (const item of input.findings) {
    const key = item.finding.package.purl;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()]
    .map((group) => planDependency(group, input.dependencies))
    .sort(
      (a, b) =>
        (b.maxRiskScore ?? -1) - (a.maxRiskScore ?? -1) ||
        b.findings.length - a.findings.length ||
        a.dependency.name.localeCompare(b.dependency.name),
    );
}

function planDependency(group: RemediationFinding[], dependencies: readonly ProjectDependency[]): DependencyRemediation {
  const first = (group[0] as RemediationFinding).finding;
  const currentVersion = first.package.version;
  const current = parseMavenVersion(currentVersion);
  const dependency = dependencies.find((d) => d.coordinate.purl === first.package.purl);

  const recommended = current ? chooseVersion(group, current) : undefined;
  const findings = group
    .map(({ id, finding }): FindingFixStatus => ({
      ...(id !== undefined ? { findingId: id } : {}),
      vulnerabilityId: finding.vulnerability.id,
      aliases: finding.vulnerability.aliases,
      severity: finding.vulnerability.severity,
      ...(finding.risk ? { riskScore: finding.risk.score } : {}),
      fixedVersions: sortVersions(finding.fixedVersions),
      status: statusAt(finding, recommended),
    }))
    .sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1) || a.vulnerabilityId.localeCompare(b.vulnerabilityId));

  const majorUpgrade =
    current !== undefined && recommended !== undefined && majorVersion(current) !== majorVersion(recommended.version);
  const fixedCount = findings.filter((f) => f.status === 'FIXED').length;
  const scores = findings.flatMap((f) => (f.riskScore !== undefined ? [f.riskScore] : []));

  return {
    dependency: {
      name: first.package.name,
      currentVersion,
      purl: first.package.purl,
      ...(dependency ? { direct: dependency.coordinate.direct } : {}),
      ...(dependency?.source.introducedBy?.length ? { introducedBy: dependency.source.introducedBy } : {}),
      ...(dependency?.source.filePath ? { declaredIn: fileName(dependency.source.filePath) } : {}),
    },
    ...(recommended ? { recommendedVersion: recommended.raw } : {}),
    majorUpgrade,
    actions: actionsFor(group, findings, dependency, currentVersion, recommended?.raw, majorUpgrade, fixedCount),
    findings,
    fixedCount,
    ...(scores.length > 0 ? { maxRiskScore: Math.max(...scores) } : {}),
    reachableEndpoints: unique(
      group.flatMap(({ finding }) =>
        (finding.reachability?.paths ?? []).map((p) => `${p.endpoint.httpMethod} ${p.endpoint.path}`),
      ),
    ),
    affectedFiles: affectedFiles(group),
    affectedMethods: unique(
      group.flatMap(({ finding }) =>
        (finding.reachability?.paths ?? []).flatMap((p) => {
          const last = p.steps[p.steps.length - 1];
          return last ? [`${last.method.className}#${last.method.methodName}`] : [];
        }),
      ),
    ),
    basis: BASIS,
  };
}

/**
 * `file:line` of main-source usages: only the vulnerable-API calls when there are any (those are
 * what to change), otherwise every usage of the dependency.
 */
function affectedFiles(group: RemediationFinding[]): string[] {
  const usages = group.flatMap(({ finding }) =>
    (finding.usage?.usages ?? []).filter((u) => u.sourceSet === 'MAIN' && u.kind !== 'IMPORT'),
  );
  const vulnerable = usages.filter((u) => u.vulnerableApi);
  return unique(
    (vulnerable.length > 0 ? vulnerable : usages).map((u) => `${u.evidence.location.filePath}:${u.evidence.location.line}`),
  ).sort();
}

/** Phase 8 D4: the lowest candidate that settles every fixable finding, else the one settling most. */
function chooseVersion(
  group: RemediationFinding[],
  current: MavenVersion,
): { version: MavenVersion; raw: string } | undefined {
  const fixable = group.filter(({ finding }) => finding.fixedVersions.length > 0);
  const candidates = uniqueVersions(fixable.flatMap(({ finding }) => finding.fixedVersions))
    .filter((c) => compareMavenVersions(c.version, current) > 0)
    .sort((a, b) => compareMavenVersions(a.version, b.version));

  let best: { version: MavenVersion; raw: string; fixed: number } | undefined;
  for (const candidate of candidates) {
    const fixed = fixable.filter(({ finding }) => isAffected(candidate.raw, finding.evidence) === 'NOT_AFFECTED').length;
    if (fixed === fixable.length) return candidate;
    if (!best || fixed > best.fixed) best = { ...candidate, fixed };
  }
  return best && best.fixed > 0 ? best : undefined;
}

function statusAt(finding: VulnerabilityFinding, recommended: { raw: string } | undefined): FixStatus {
  if (finding.fixedVersions.length === 0) return 'NO_FIX';
  if (!recommended) return 'UNKNOWN';
  const status = isAffected(recommended.raw, finding.evidence);
  return status === 'NOT_AFFECTED' ? 'FIXED' : status === 'AFFECTED' ? 'STILL_AFFECTED' : 'UNKNOWN';
}

function actionsFor(
  group: RemediationFinding[],
  findings: FindingFixStatus[],
  dependency: ProjectDependency | undefined,
  currentVersion: string,
  recommended: string | undefined,
  majorUpgrade: boolean,
  fixedCount: number,
): RemediationAction[] {
  const actions: RemediationAction[] = [];
  const name = (group[0] as RemediationFinding).finding.package.name;
  const [groupId, artifactId] = name.split(':');
  if (recommended) {
    const settles = `fixes ${fixedCount} of ${findings.length} finding${findings.length === 1 ? '' : 's'}`;
    const major = majorUpgrade ? ' Major version change: check for breaking API changes.' : '';
    if (dependency && !dependency.coordinate.direct) {
      const via = dependency.source.introducedBy?.[0];
      actions.push({
        kind: 'OVERRIDE_TRANSITIVE',
        description:
          `Pin ${name} to ${recommended} in <dependencyManagement> (${settles})` +
          (via ? `, or upgrade ${via}, which pulls in ${currentVersion} — which of its versions fixes this is not known.` : '.') +
          major,
      });
    } else {
      actions.push({
        kind: 'UPGRADE_DIRECT',
        description:
          `Change <version> of ${groupId}:${artifactId} from ${currentVersion} to ${recommended} in ${dependency ? fileName(dependency.source.filePath) || 'pom.xml' : 'pom.xml'} (${settles}).` +
          major,
      });
    }
  }

  const noFix = findings.filter((f) => f.status === 'NO_FIX').length;
  if (noFix > 0 || !recommended) {
    const count = noFix > 0 ? noFix : findings.length;
    actions.push({
      kind: 'NO_FIX',
      description:
        `${count} finding${count === 1 ? ' has' : 's have'} no usable fixed version: remove or isolate the usages listed below, ` +
        'restrict input reaching them, or replace the library.',
    });
  }

  const usageKnown = group.every(({ finding }) => finding.usage !== undefined);
  const unused = usageKnown && group.every(({ finding }) => !finding.usage?.used);
  if (unused && dependency?.coordinate.direct) {
    actions.push({
      kind: 'REVIEW_UNUSED',
      description:
        'No main-source usage was found. If it is not needed at runtime (drivers, starters and reflective use are not detected), removing it settles every finding.',
    });
  }
  return actions;
}

function uniqueVersions(raws: string[]): { version: MavenVersion; raw: string }[] {
  const seen = new Set<string>();
  const out: { version: MavenVersion; raw: string }[] = [];
  for (const raw of raws) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const version = parseMavenVersion(raw);
    if (version) out.push({ version, raw });
  }
  return out;
}

/** Maven order; strings that cannot be parsed keep their order at the end. */
function sortVersions(raws: readonly string[]): string[] {
  const parsed = uniqueVersions([...raws]).sort((a, b) => compareMavenVersions(a.version, b.version)).map((v) => v.raw);
  return [...parsed, ...raws.filter((r) => !parsed.includes(r))];
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
