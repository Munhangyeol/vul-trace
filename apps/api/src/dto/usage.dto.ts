import type { FindingUsage, FindingUsageSummaryDto, FindingUsagesDto, SourceUsageDto } from '@vulntrace/shared';
import type { StoredFinding } from '@vulntrace/core';

export type { FindingUsageSummaryDto, FindingUsagesDto, SourceUsageDto };

export function toFindingUsageSummaryDto(usage: FindingUsage | undefined): FindingUsageSummaryDto | null {
  if (!usage) return null;
  return {
    used: usage.used,
    ...(usage.viaApi ? { viaApi: usage.viaApi } : {}),
    vulnerableApi: usage.vulnerableApi,
    packageMapping: usage.packageMapping,
    vulnerableApis: usage.vulnerableApis,
    mainUsageCount: usage.usages.filter((u) => u.sourceSet === 'MAIN').length,
    testUsageCount: usage.usages.filter((u) => u.sourceSet === 'TEST').length,
  };
}

export function toFindingUsagesDto(stored: StoredFinding): FindingUsagesDto {
  const usage = stored.finding.usage;
  return {
    findingId: stored.id,
    analyzed: usage !== undefined,
    summary: toFindingUsageSummaryDto(usage),
    usages: (usage?.usages ?? []).map(
      (u): SourceUsageDto => ({
        kind: u.kind,
        symbol: u.symbol,
        sourceSet: u.sourceSet,
        vulnerableApi: u.vulnerableApi,
        filePath: u.evidence.location.filePath,
        line: u.evidence.location.line,
        ...(u.evidence.location.column !== undefined ? { column: u.evidence.location.column } : {}),
        snippet: u.evidence.snippet,
      }),
    ),
  };
}
