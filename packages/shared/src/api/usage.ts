import type {
  PackageMapping,
  SourceSet,
  UsageKind,
  VulnerableApiRef,
  VulnerableApiStatus,
} from '../types/source-usage.js';

/** Phase 4 conclusion for a finding, without the evidence rows (see `FindingUsagesDto`). */
export interface FindingUsageSummaryDto {
  used: boolean;
  vulnerableApi: VulnerableApiStatus;
  packageMapping: PackageMapping;
  vulnerableApis: VulnerableApiRef[];
  mainUsageCount: number;
  testUsageCount: number;
}

export interface SourceUsageDto {
  kind: UsageKind;
  symbol: string;
  sourceSet: SourceSet;
  vulnerableApi: boolean;
  filePath: string;
  line: number;
  column?: number;
  snippet: string;
}

/** GET /api/findings/:findingId/usages */
export interface FindingUsagesDto {
  findingId: string;
  /** False when source usage was not analyzed for this finding's scan — `usages` is then empty. */
  analyzed: boolean;
  summary: FindingUsageSummaryDto | null;
  usages: SourceUsageDto[];
}
