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
  return usage.used ? 'Yes' : 'No';
}

export function formatPackageMappingBasis(
  basis: FindingUsageSummaryDto['packageMapping']['basis'],
): string {
  return basis === 'CURATED' ? 'curated mapping' : 'assumed from groupId';
}
