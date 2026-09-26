import type { AnalysisError, ProjectDependency, Result } from '@vulntrace/shared';
import { NotImplementedError, err } from '@vulntrace/shared';
import type { CycloneDxBom } from './types.js';

export interface SbomBuilder {
  build(dependencies: ProjectDependency[]): Result<CycloneDxBom, AnalysisError>;
}

/** Phase 2 */
export class CycloneDxBuilder implements SbomBuilder {
  build(_dependencies: ProjectDependency[]): Result<CycloneDxBom, AnalysisError> {
    return err(new NotImplementedError('CycloneDxBuilder'));
  }
}
