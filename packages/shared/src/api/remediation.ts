import type { DependencyRemediation, FindingFixStatus, FixStatus } from '../types/remediation.js';

/** A finding row in a fix plan, with the display id the UI shows. */
export interface FindingFixStatusDto extends FindingFixStatus {
  displayId: string;
}

export interface DependencyRemediationDto extends Omit<DependencyRemediation, 'findings'> {
  findings: FindingFixStatusDto[];
}

/** GET /api/projects/:projectId/remediation — the latest scan's fix plan, highest risk first. */
export interface ProjectRemediationDto {
  /** null when the project has never been scanned. */
  scanId: string | null;
  dependencies: DependencyRemediationDto[];
}

/** GET /api/findings/:findingId/remediation — the plan for this finding's dependency. */
export interface FindingRemediationDto {
  findingId: string;
  /** What the recommended version does for this finding. */
  status: FixStatus;
  remediation: DependencyRemediationDto;
}
