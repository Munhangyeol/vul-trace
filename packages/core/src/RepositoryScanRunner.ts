import { resolve, sep } from 'node:path';
import type { ScanStage, ScanStageResult } from '@vulntrace/shared';
import type { RepositorySource, RepositoryTarget } from '@vulntrace/repository-source';
import type { ScanLogger } from './logging/ScanLogger.js';
import type {
  ScanOptions,
  ScanOrchestrator,
  ScanReport,
  ScanReportSource,
} from './ScanOrchestrator.js';

type LocalTarget = Extract<RepositoryTarget, { type: 'LOCAL' }>;
type GitTarget = Extract<RepositoryTarget, { type: 'GIT' }>;

/** What the runner needs from a GIT source; tests substitute a fake that never clones. */
export type GitRepositoryPort = RepositorySource<GitTarget>;

export interface RepositoryScanRunnerDeps {
  orchestrator: ScanOrchestrator;
  localSource: RepositorySource<LocalTarget>;
  gitSource: GitRepositoryPort;
  logger: ScanLogger;
  now?: () => Date;
}

/** Every analysis stage, in order — used to mark them SKIPPED when the repository never arrived. */
const ANALYSIS_STAGES: readonly ScanStage[] = [
  'PROJECT_DETECTION',
  'DEPENDENCY',
  'DEPENDENCY_TREE',
  'SBOM',
  'VULNERABILITY',
  'SOURCE_USAGE',
  'SPRING_ENDPOINT',
  'REACHABILITY',
  'RISK',
];

const DEFAULT_SCAN_OPTIONS: ScanOptions = { allowMaven: false, checkVulnerabilities: true };

/**
 * Rewrites absolute paths under a temporary clone (`workDir`) to repository-relative ones, so
 * stored evidence points into the repository (`pom.xml`) instead of a folder deleted after the
 * scan. Pure; LOCAL scans keep their paths untouched.
 */
export function relativizeReportPaths(report: ScanReport, workDir: string): ScanReport {
  const root = resolve(workDir);
  const prefix = root + sep;
  const relativize = (path: string): string => {
    if (path === root) return '.';
    if (!path.startsWith(prefix)) return path;
    return path.slice(prefix.length).split(sep).join('/');
  };
  const scrub = (text: string): string => text.split(prefix).join('').split(root).join('.');

  return {
    ...report,
    project: report.project
      ? { ...report.project, pomPath: relativize(report.project.pomPath) }
      : undefined,
    dependencies: report.dependencies.map((d) => ({
      ...d,
      source: { ...d.source, filePath: relativize(d.source.filePath) },
    })),
    unresolvedDependencies: report.unresolvedDependencies.map((d) => ({
      ...d,
      source: { ...d.source, filePath: relativize(d.source.filePath) },
    })),
    stages: report.stages.map((s) => (s.reason ? { ...s, reason: scrub(s.reason) } : s)),
    warnings: report.warnings.map(scrub),
  };
}

/**
 * Entry point for API and CLI: turns a scan target (local folder or GitHub URL) into a folder,
 * runs the unchanged ScanOrchestrator on it, and always cleans up afterwards.
 */
export class RepositoryScanRunner {
  private readonly now: () => Date;

  constructor(private readonly deps: RepositoryScanRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(
    target: RepositoryTarget,
    options: ScanOptions = DEFAULT_SCAN_OPTIONS,
  ): Promise<ScanReport> {
    if (target.type === 'LOCAL') return this.runLocal(target, options);
    return this.runGit(target, options);
  }

  private async runLocal(target: LocalTarget, options: ScanOptions): Promise<ScanReport> {
    const acquired = await this.deps.localSource.acquire(target);
    if (!acquired.ok)
      return this.fetchFailedReport(
        target.path,
        { type: 'LOCAL', path: target.path },
        acquired.error.message,
      );
    try {
      const report = await this.deps.orchestrator.run(acquired.value.workDir, options);
      return { ...report, source: acquired.value.evidence };
    } finally {
      await acquired.value.release();
    }
  }

  private async runGit(target: GitTarget, options: ScanOptions): Promise<ScanReport> {
    const { logger } = this.deps;
    const label = `${target.repoUrl}${target.ref ? ` (${target.ref})` : ''}`;
    logger.info('REPOSITORY', `fetching ${label}`);

    const acquired = await this.deps.gitSource.acquire(target);
    if (!acquired.ok) {
      const reason = `${acquired.error.code}: ${acquired.error.message}`;
      logger.error('REPOSITORY', reason);
      return this.fetchFailedReport(
        target.repoUrl,
        { type: 'GIT', repoUrl: target.repoUrl, ref: target.ref },
        reason,
      );
    }

    const { workDir, evidence } = acquired.value;
    if (evidence.type === 'GIT')
      logger.info('REPOSITORY', `cloned ${evidence.repoUrl} at ${evidence.commitSha}`);

    const warnings: string[] = [];
    if (options.allowMaven) {
      warnings.push(
        'Maven was enabled for a cloned repository: its pom.xml can make Maven download and run plugins (CLAUDE.md §16)',
      );
    }

    let report: ScanReport;
    try {
      report = relativizeReportPaths(await this.deps.orchestrator.run(workDir, options), workDir);
    } finally {
      const released = await acquired.value.release();
      if (released.warning) {
        warnings.push(released.warning);
        logger.error('REPOSITORY', released.warning);
      } else {
        logger.info('REPOSITORY', 'temporary workspace removed');
      }
    }

    // State stays the analysis' own: a clone of a non-Maven repository is still a FAILED scan.
    return {
      ...report,
      projectPath: evidence.type === 'GIT' ? evidence.repoUrl : report.projectPath,
      source: evidence,
      stages: [{ stage: 'REPOSITORY_FETCH', status: 'SUCCEEDED' }, ...report.stages],
      warnings: [...warnings, ...report.warnings],
    };
  }

  private fetchFailedReport(
    projectPath: string,
    source: ScanReportSource,
    reason: string,
  ): ScanReport {
    const timestamp = this.now().toISOString();
    const stages: ScanStageResult[] = [
      { stage: 'REPOSITORY_FETCH', status: 'FAILED', reason },
      ...ANALYSIS_STAGES.map((stage): ScanStageResult => ({
        stage,
        status: 'SKIPPED',
        reason: 'repository not fetched',
      })),
    ];
    this.deps.logger.info('SCAN', 'scan finished: FAILED');
    return {
      projectPath,
      state: 'FAILED',
      startedAt: timestamp,
      finishedAt: timestamp,
      stages,
      dependencies: [],
      unresolvedDependencies: [],
      findings: [],
      vulnerabilityCoverage: { checked: 0, notChecked: 0, failed: 0 },
      warnings: [],
      source,
    };
  }
}
