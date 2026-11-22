import type { FixStatus, RemediationActionKind } from '@vulntrace/shared';

const FIX_STATUS_LABEL: Record<FixStatus, string> = {
  FIXED: 'Fixed',
  STILL_AFFECTED: 'Still affected',
  NO_FIX: 'No fix published',
  UNKNOWN: 'Cannot evaluate',
};

export function formatFixStatus(status: FixStatus): string {
  return FIX_STATUS_LABEL[status];
}

const ACTION_LABEL: Record<RemediationActionKind, string> = {
  UPGRADE_DIRECT: 'Upgrade',
  OVERRIDE_TRANSITIVE: 'Pin transitive version',
  NO_FIX: 'No fix available',
  REVIEW_UNUSED: 'Review unused dependency',
};

export function formatActionKind(kind: RemediationActionKind): string {
  return ACTION_LABEL[kind];
}

/** `1.9 → 1.10.0`, or `1.9 (no fixed version)` when nothing can be recommended. */
export function formatUpgrade(currentVersion: string, recommendedVersion: string | undefined): string {
  return recommendedVersion ? `${currentVersion} → ${recommendedVersion}` : `${currentVersion} (no fixed version)`;
}
