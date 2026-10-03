import type { ScanState, ScanStageResult, VulnerabilityCoverage } from '../types/project.js';
import type { UnresolvedDependency } from '../types/dependency.js';

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
