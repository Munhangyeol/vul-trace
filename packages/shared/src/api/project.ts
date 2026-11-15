import type { ProjectSourceType, ScanState } from '../types/project.js';
import type { Severity } from '../types/vulnerability.js';

export interface ProjectDto {
  id: string;
  name: string;
  sourceType: ProjectSourceType;
  /** LOCAL projects only. */
  path?: string;
  /** GIT projects only: normalized https://github.com/<owner>/<repo>. */
  repoUrl?: string;
  /** GIT projects only: branch or tag; absent means the default branch. */
  ref?: string;
  createdAt: string;
}

/** Aggregated numbers for a project's most recent scan, shown alongside the project in a list. */
export interface ProjectLatestScanDto {
  id: string;
  state: ScanState;
  finishedAt?: string;
  commitSha?: string;
  dependencyCount: number;
  vulnerabilityCount: number;
  bySeverity: Record<Severity, number>;
}

/** CLAUDE.md §12 Project List: adds `latestScan` without changing existing `ProjectDto` fields. */
export interface ProjectListItemDto extends ProjectDto {
  latestScan?: ProjectLatestScanDto;
}
