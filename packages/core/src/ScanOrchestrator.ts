import type {
  ProjectDependency,
  ScanStage,
  ScanStageResult,
  ScanState,
  UnresolvedDependency,
} from '@vulntrace/shared';
import type {
  DependencyAnalysisOptions,
  DependencyAnalyzer,
  MavenProjectMetadata,
} from '@vulntrace/dependency-analyzer';
import type { ScanLogger } from './logging/ScanLogger.js';

export interface ScanReport {
  projectPath: string;
  state: ScanState;
  startedAt: string;
  finishedAt: string;
  stages: ScanStageResult[];
  project?: MavenProjectMetadata;
  dependencies: ProjectDependency[];
  unresolvedDependencies: UnresolvedDependency[];
  warnings: string[];
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

const PROJECT_DETECTION_ERROR_CODES = new Set(['PROJECT_NOT_FOUND', 'UNSUPPORTED_PROJECT']);

const DEFAULT_DEPENDENCY_OPTIONS: DependencyAnalysisOptions = { allowMaven: false };

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

  async run(
    projectPath: string,
    options: DependencyAnalysisOptions = DEFAULT_DEPENDENCY_OPTIONS,
  ): Promise<ScanReport> {
    const { logger } = this.deps;
    const startedAt = this.now().toISOString();
    const stages: ScanStageResult[] = [];
    let project: MavenProjectMetadata | undefined;
    let dependencies: ProjectDependency[] = [];
    let unresolvedDependencies: UnresolvedDependency[] = [];
    let warnings: string[] = [];

    logger.info('SCAN', `scan started: ${projectPath}`);

    const analysis = await this.deps.dependencyAnalyzer.analyze(projectPath, options);

    if (!analysis.ok) {
      const reason = `${analysis.error.code}: ${analysis.error.message}`;
      const stage: ScanStage = PROJECT_DETECTION_ERROR_CODES.has(analysis.error.code)
        ? 'PROJECT_DETECTION'
        : 'DEPENDENCY';
      stages.push({ stage, status: 'FAILED', reason });
      logger.error(stage === 'PROJECT_DETECTION' ? 'PROJECT' : 'DEPENDENCY', reason);
    } else {
      const result = analysis.value;
      project = result.project;
      dependencies = result.dependencies;
      unresolvedDependencies = result.unresolvedDependencies;
      warnings = result.warnings;

      stages.push({ stage: 'PROJECT_DETECTION', status: 'SUCCEEDED' });
      logger.info(
        'PROJECT',
        `Maven project detected: ${project.groupId}:${project.artifactId}:${project.version}`,
      );

      stages.push({ stage: 'DEPENDENCY', status: 'SUCCEEDED' });
      logger.info(
        'DEPENDENCY',
        `${dependencies.length} dependencies resolved, ${unresolvedDependencies.length} unresolved`,
      );

      if (result.transitive.status === 'RESOLVED') {
        stages.push({ stage: 'DEPENDENCY_TREE', status: 'SUCCEEDED' });
      } else if (result.transitive.status === 'SKIPPED') {
        stages.push({
          stage: 'DEPENDENCY_TREE',
          status: 'SKIPPED',
          reason: result.transitive.reason,
        });
        logger.info('DEPENDENCY', `transitive resolution skipped: ${result.transitive.reason}`);
      } else {
        stages.push({
          stage: 'DEPENDENCY_TREE',
          status: 'FAILED',
          reason: result.transitive.reason,
        });
        logger.error('DEPENDENCY', `transitive resolution failed: ${result.transitive.reason}`);
      }
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
      project,
      dependencies,
      unresolvedDependencies,
      warnings,
    };
  }
}
