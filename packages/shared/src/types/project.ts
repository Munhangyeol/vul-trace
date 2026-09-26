import type { UnresolvedDependency } from './dependency.js';

export type ScanState = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED';

/** Pipeline stages in execution order (CLAUDE.md §1 Core Flow). */
export type ScanStage =
  | 'PROJECT_DETECTION'
  | 'DEPENDENCY'
  | 'DEPENDENCY_TREE'
  | 'SBOM'
  | 'VULNERABILITY'
  | 'SOURCE_USAGE'
  | 'SPRING_ENDPOINT'
  | 'REACHABILITY'
  | 'RISK';

export type StageStatus = 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface ScanStageResult {
  stage: ScanStage;
  status: StageStatus;
  /** Recorded whenever status is FAILED or SKIPPED (CLAUDE.md §19). */
  reason?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface ScanJob {
  id: string;
  projectId: string;
  state: ScanState;
  startedAt: string;
  finishedAt?: string;
  failureReason?: string;
  stages: ScanStageResult[];
  /** Dependencies whose version could not be resolved from pom.xml/tree — evidence, not just a count. */
  unresolvedDependencies: UnresolvedDependency[];
}
