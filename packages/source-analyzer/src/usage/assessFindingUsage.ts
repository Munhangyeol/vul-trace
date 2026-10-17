import type {
  FindingUsage,
  SourceUsage,
  VulnerabilityFinding,
  VulnerableApiRef,
} from '@vulntrace/shared';
import type { DependencyUsage, MatchedUsage } from './UsageMatcher.js';
import { findVulnerableApis } from './vulnerableApis.js';

function matchesVulnerableApi(usage: MatchedUsage, api: VulnerableApiRef): boolean {
  if (api.method) return usage.kind === 'METHOD_CALL' && usage.symbol === `${api.type}#${api.method}`;
  return usage.kind !== 'IMPORT' && (usage.symbol === api.type || usage.symbol.startsWith(`${api.type}#`));
}

/**
 * Combines a dependency's usage evidence with the finding's known vulnerable APIs into the
 * Phase 4 conclusion. Only MAIN-source usages decide `used` and `vulnerableApi` (plan D5).
 */
export function assessFindingUsage(
  finding: VulnerabilityFinding,
  dependencyUsage: DependencyUsage,
): FindingUsage {
  const vulnerableApis = findVulnerableApis(finding);
  const usages: SourceUsage[] = dependencyUsage.usages.map((usage) => ({
    ...usage,
    vulnerableApi: vulnerableApis.some((api) => matchesVulnerableApi(usage, api)),
  }));
  const mainUsages = usages.filter((u) => u.sourceSet === 'MAIN');

  return {
    used: mainUsages.length > 0,
    vulnerableApi:
      vulnerableApis.length === 0
        ? 'NO_API_INFO'
        : mainUsages.some((u) => u.vulnerableApi)
          ? 'USED'
          : 'NOT_DETECTED',
    packageMapping: dependencyUsage.packageMapping,
    vulnerableApis,
    usages,
  };
}
