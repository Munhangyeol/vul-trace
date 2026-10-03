import type { ScanStageResult, ScanState, VulnerabilityCoverage } from '../types/project.js';
import type { UnresolvedDependency } from '../types/dependency.js';
import type { Severity } from '../types/vulnerability.js';
import type { ProjectDto } from './project.js';

/** Aggregated numbers + evidence for one scan, shown on the project dashboard (CLAUDE.md §12). */
export interface ProjectScanSummaryDto {
  scanId: string;
  state: ScanState;
  startedAt: string;
  finishedAt?: string;
  stages: ScanStageResult[];
  dependencies: number;
  vulnerabilities: number;
  findings: number;
  bySeverity: Record<Severity, number>;
  coverage: VulnerabilityCoverage;
  unresolvedDependencies: UnresolvedDependency[];
}

export interface ProjectSummaryDto {
  project: ProjectDto;
  /** null when the project has never been scanned. */
  latestScan: ProjectScanSummaryDto | null;
}
