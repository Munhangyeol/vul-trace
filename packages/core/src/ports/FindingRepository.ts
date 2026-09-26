import type { ProjectDependency, VulnerabilityFinding } from '@vulntrace/shared';

/** A finding as stored — `id` is stable per (scan, dependency, vulnerability), used for `GET /findings/:id`. */
export interface StoredFinding {
  id: string;
  finding: VulnerabilityFinding;
}

export interface FindingRepository {
  saveDependencies(scanId: string, dependencies: ProjectDependency[]): Promise<void>;
  saveFindings(scanId: string, findings: VulnerabilityFinding[]): Promise<void>;
  listDependencies(scanId: string): Promise<ProjectDependency[]>;
  listFindings(scanId: string): Promise<StoredFinding[]>;
  findFindingById(findingId: string): Promise<StoredFinding | null>;
}
