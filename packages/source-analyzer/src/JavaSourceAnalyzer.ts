import { NotImplementedError } from '@vulntrace/shared';
import type { JavaAnalysisResult } from './types.js';

/**
 * Entry point for Java analysis (CLAUDE.md §14). Callers depend only on this
 * interface so a Stage B adapter (`java -jar java-analyzer.jar`) can replace
 * the TypeScript implementation without changing calling code.
 */
export interface JavaSourceAnalyzer {
  analyzeProject(projectPath: string): Promise<JavaAnalysisResult>;
}

/** Phase 4 — Stage A, TypeScript-only analysis. */
export class LightweightJavaSourceAnalyzer implements JavaSourceAnalyzer {
  async analyzeProject(_projectPath: string): Promise<JavaAnalysisResult> {
    throw new NotImplementedError('LightweightJavaSourceAnalyzer');
  }
}
