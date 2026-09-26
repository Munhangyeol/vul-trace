import type { ScanJob, ScanStageResult, ScanState, UnresolvedDependency } from '@vulntrace/shared';

export interface ScanJobDto {
  id: string;
  projectId: string;
  state: ScanState;
  startedAt: string;
  finishedAt?: string;
  failureReason?: string;
  stages: ScanStageResult[];
  unresolvedDependencies: UnresolvedDependency[];
}

export function toScanJobDto(scan: ScanJob): ScanJobDto {
  return {
    id: scan.id,
    projectId: scan.projectId,
    state: scan.state,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    failureReason: scan.failureReason,
    stages: scan.stages,
    unresolvedDependencies: scan.unresolvedDependencies,
  };
}
