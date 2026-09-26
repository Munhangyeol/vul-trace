import type {
  ProjectDependency,
  ScanStage,
  ScanStageResult,
  ScanState,
} from '@vulntrace/shared';
import type { DependencyAnalyzer } from '@vulntrace/dependency-analyzer';
import type { ScanLogger } from './logging/ScanLogger.js';

export interface ScanReport {
  projectPath: string;
  state: ScanState;
  startedAt: string;
  finishedAt: string;
  stages: ScanStageResult[];
  dependencies: ProjectDependency[];
}

export interface ScanOrchestratorDeps {
  dependencyAnalyzer: DependencyAnalyzer;
  logger: ScanLogger;
  now?: () => Date;
}

/** Stages not wired into the pipeline yet, with the phase that introduces them. */
const PENDING_STAGES: ReadonlyArray<readonly [ScanStage, string]> = [
  ['SBOM', 'Phase 2'],
  ['VULNERABILITY', 'Phase 2'],
  ['SOURCE_USAGE', 'Phase 4'],
  ['SPRING_ENDPOINT', 'Phase 5'],
  ['REACHABILITY', 'Phase 6'],
  ['RISK', 'Phase 7'],
];

/**
 * Derives the overall scan state from stage results (CLAUDE.md §19).
 * A failure after at least one successful stage is PARTIAL so earlier results are kept.
 */
export function deriveScanState(stages: readonly ScanStageResult[]): ScanState {
  const failed = stages.some((s) => s.status === 'FAILED');
  const succeeded = stages.some((s) => s.status === 'SUCCEEDED');
  if (!failed) return 'COMPLETED';
  return succeeded ? 'PARTIAL' : 'FAILED';
}

/** Single analysis pipeline shared by the API and the CLI (CLAUDE.md §11). */
export class ScanOrchestrator {
  private readonly now: () => Date;

  constructor(private readonly deps: ScanOrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(projectPath: string): Promise<ScanReport> {
    const { logger } = this.deps;
    const startedAt = this.now().toISOString();
    const stages: ScanStageResult[] = [];
    let dependencies: ProjectDependency[] = [];

    logger.info('SCAN', `scan started: ${projectPath}`);

    const dependencyResult = await this.deps.dependencyAnalyzer.analyze(projectPath);
    if (dependencyResult.ok) {
      dependencies = dependencyResult.value.dependencies;
      stages.push({ stage: 'DEPENDENCY', status: 'SUCCEEDED' });
      logger.info('DEPENDENCY', `${dependencies.length} dependencies found`);
    } else {
      const reason = `${dependencyResult.error.code}: ${dependencyResult.error.message}`;
      stages.push({ stage: 'DEPENDENCY', status: 'FAILED', reason });
      logger.error('DEPENDENCY', reason);
    }

    for (const [stage, phase] of PENDING_STAGES) {
      stages.push({ stage, status: 'SKIPPED', reason: `not implemented (${phase})` });
    }

    const state = deriveScanState(stages);
    logger.info('SCAN', `scan finished: ${state}`);

    return {
      projectPath,
      state,
      startedAt,
      finishedAt: this.now().toISOString(),
      stages,
      dependencies,
    };
  }
}
