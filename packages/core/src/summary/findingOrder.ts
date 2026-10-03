import type { Vulnerability, VulnerabilityFinding } from '@vulntrace/shared';

/** A CVE alias if present, otherwise the OSV id (CLAUDE.md §7 Phase 2 §2.4). */
export function pickDisplayId(vulnerability: Vulnerability): string {
  return vulnerability.aliases.find((a) => a.startsWith('CVE-')) ?? vulnerability.id;
}

export const SEVERITY_RANK: Record<Vulnerability['severity'], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

/** Highest severity first, then highest CVSS, then dependency name (stable display order). */
export function compareFindings(a: VulnerabilityFinding, b: VulnerabilityFinding): number {
  const severityDiff = SEVERITY_RANK[b.vulnerability.severity] - SEVERITY_RANK[a.vulnerability.severity];
  if (severityDiff !== 0) return severityDiff;
  const cvssDiff = (b.vulnerability.cvssScore ?? 0) - (a.vulnerability.cvssScore ?? 0);
  if (cvssDiff !== 0) return cvssDiff;
  return a.package.name.localeCompare(b.package.name);
}
