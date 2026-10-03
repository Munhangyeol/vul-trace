import type { ScanJob, ScanJobDto } from '@vulntrace/shared';

export type { ScanJobDto };

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
