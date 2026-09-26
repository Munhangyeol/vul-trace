import type { ProjectDependency, VulnerabilityFinding } from '@vulntrace/shared';

export interface FindingRepository {
  saveDependencies(scanId: string, dependencies: ProjectDependency[]): Promise<void>;
  saveFindings(scanId: string, findings: VulnerabilityFinding[]): Promise<void>;
  listDependencies(scanId: string): Promise<ProjectDependency[]>;
  listFindings(scanId: string): Promise<VulnerabilityFinding[]>;
}
