import type { FindingUsageSummaryDto, VulnerableApiStatus } from '@vulntrace/shared';

const VULNERABLE_API_LABEL: Record<VulnerableApiStatus, string> = {
  USED: 'vulnerable API used',
  NOT_DETECTED: 'vulnerable API not detected',
  NO_API_INFO: 'no vulnerable API info',
};

/** Static analysis cannot prove absence, so NOT_DETECTED is never shown as "not used". */
export function formatVulnerableApi(status: VulnerableApiStatus): string {
  return VULNERABLE_API_LABEL[status];
}

/** 'Yes' / 'No' once source usage was analyzed, '—' when it was not (null ≠ false). */
export function formatUsed(usage: FindingUsageSummaryDto | null): string {
  if (!usage) return '—';
  if (!usage.used) return 'No';
  return usage.viaApi ? 'Yes (via API)' : 'Yes';
}

export function formatPackageMappingBasis(
  basis: FindingUsageSummaryDto['packageMapping']['basis'],
): string {
  return basis === 'CURATED' ? 'curated mapping' : 'assumed from groupId';
}

/** `pkg:maven/org.apache.logging.log4j/log4j-api@2.9.1` → `log4j-api@2.9.1` for compact display. */
export function formatPurlName(purl: string): string {
  const match = /^pkg:maven\/[^/]+\/([^@]+)@(.+)$/.exec(purl);
  return match ? `${match[1]}@${match[2]}` : purl;
}
