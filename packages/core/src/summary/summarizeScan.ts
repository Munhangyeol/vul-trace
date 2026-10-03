import type {
  ProjectDependency,
  Severity,
  UnresolvedDependency,
  VulnerabilityCoverage,
  VulnerabilityFinding,
} from '@vulntrace/shared';

export interface ScanSummaryInput {
  dependencies: readonly ProjectDependency[];
  unresolvedDependencies: readonly UnresolvedDependency[];
  findings: readonly VulnerabilityFinding[];
  vulnerabilityCoverage: VulnerabilityCoverage;
}

export interface ScanSummary {
  dependencies: number;
  unresolved: number;
  /** Count of distinct vulnerabilities (by id), not finding rows. */
  vulnerabilities: number;
  /** Count of finding rows (one dependency can have several vulnerabilities). */
  findings: number;
  vulnerableDependencies: number;
  bySeverity: Record<Severity, number>;
  coverage: VulnerabilityCoverage;
}

const EMPTY_SEVERITY_COUNTS: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  UNKNOWN: 0,
};

/** Aggregates scan results into the summary numbers CLAUDE.md §7 Phase 3 requires (shared by CLI and API). */
export function summarizeScan(input: ScanSummaryInput): ScanSummary {
  const uniqueVulnerabilities = new Map<string, VulnerabilityFinding['vulnerability']>();
  for (const finding of input.findings) {
    uniqueVulnerabilities.set(finding.vulnerability.id, finding.vulnerability);
  }

  const bySeverity: Record<Severity, number> = { ...EMPTY_SEVERITY_COUNTS };
  for (const vulnerability of uniqueVulnerabilities.values()) {
    bySeverity[vulnerability.severity] += 1;
  }

  const vulnerableDependencies = new Set(input.findings.map((f) => f.package.purl)).size;

  return {
    dependencies: input.dependencies.length,
    unresolved: input.unresolvedDependencies.length,
    vulnerabilities: uniqueVulnerabilities.size,
    findings: input.findings.length,
    vulnerableDependencies,
    bySeverity,
    coverage: input.vulnerabilityCoverage,
  };
}
