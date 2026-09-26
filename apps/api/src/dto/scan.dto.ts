import type {
  ScanJob,
  ScanStageResult,
  ScanState,
  UnresolvedDependency,
  VulnerabilityCoverage,
} from '@vulntrace/shared';

export interface ScanJobDto {
  id: string;
  projectId: string;
  state: ScanState;
  startedAt: string;
  finishedAt?: string;
  failureReason?: string;
  stages: ScanStageResult[];
  unresolvedDependencies: UnresolvedDependency[];
  vulnerabilityCoverage: VulnerabilityCoverage;
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
    vulnerabilityCoverage: scan.vulnerabilityCoverage,
  };
}
