import type { AnalysisError, ProjectDependency, Result } from '@vulntrace/shared';
import { NotImplementedError, err } from '@vulntrace/shared';

export interface MavenProjectMetadata {
  groupId: string;
  artifactId: string;
  version: string;
  pomPath: string;
}

export interface DependencyAnalysisResult {
  project: MavenProjectMetadata;
  dependencies: ProjectDependency[];
  /** False when `mvn dependency:tree` was unavailable and only direct deps were extracted. */
  transitiveResolved: boolean;
  warnings: string[];
}

export interface DependencyAnalyzer {
  analyze(projectPath: string): Promise<Result<DependencyAnalysisResult, AnalysisError>>;
}

/** Phase 1: pom.xml detection/parsing + `mvn dependency:tree` (execFile, timeout). */
export class MavenDependencyAnalyzer implements DependencyAnalyzer {
  async analyze(_projectPath: string): Promise<Result<DependencyAnalysisResult, AnalysisError>> {
    return err(new NotImplementedError('MavenDependencyAnalyzer'));
  }
}
