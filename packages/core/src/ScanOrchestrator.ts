import type {
  PackageCoordinate,
  ProjectDependency,
  ScanStage,
  ScanStageResult,
  ScanState,
  SpringEndpoint,
  UnresolvedDependency,
  VulnerabilityCoverage,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import type {
  DependencyAnalysisOptions,
  DependencyAnalyzer,
  MavenProjectMetadata,
} from '@vulntrace/dependency-analyzer';
import type { CycloneDxBom, SbomBuilder } from '@vulntrace/sbom';
import type { VulnerabilityProvider } from '@vulntrace/vulnerability';
import {
  applyApiImplementations,
  assessFindingUsage,
  matchDependencyUsages,
} from '@vulntrace/source-analyzer';
import type {
  JavaAnalysisResult,
  JavaSourceAnalyzer,
  SkippedJavaFile,
} from '@vulntrace/source-analyzer';
import { SpringEndpointAnalyzer } from '@vulntrace/spring-analyzer';
import { ReachabilityAnalyzer } from '@vulntrace/reachability';
import type { CallGraphStats } from '@vulntrace/reachability';
import { RiskScoreCalculator } from '@vulntrace/risk';
import { pickDisplayId } from './summary/findingOrder.js';
import type { ScanLogger } from './logging/ScanLogger.js';

export interface ScanOptions extends DependencyAnalysisOptions {
  /** Whether to query OSV for the resolved dependencies. Defaults to true (CLAUDE.md §7 Phase 2 D3). */
  checkVulnerabilities?: boolean;
}

/** What the SOURCE_USAGE stage actually covered — evidence for "not used" conclusions. */
export interface SourceAnalysisSummary {
  mainFiles: number;
  testFiles: number;
  skippedFiles: SkippedJavaFile[];
  /** Resolved dependencies with at least one usage in MAIN sources. */
  usedDependencies: number;
}

/**
 * Which code the report describes. Set by RepositoryScanRunner; `commitSha` is present for a
 * GIT scan once the clone succeeded.
 */
export type ScanReportSource =
  | { type: 'LOCAL'; path: string }
  | { type: 'GIT'; repoUrl: string; ref?: string; commitSha?: string };

export interface ScanReport {
  /** Analyzed folder for LOCAL scans; the repository URL for GIT scans. */
  projectPath: string;
  source?: ScanReportSource;
  state: ScanState;
  startedAt: string;
  finishedAt: string;
  stages: ScanStageResult[];
  project?: MavenProjectMetadata;
  dependencies: ProjectDependency[];
  unresolvedDependencies: UnresolvedDependency[];
  sbom?: CycloneDxBom;
  /** Findings carry `usage` once the SOURCE_USAGE stage succeeded (Phase 4). */
  findings: VulnerabilityFinding[];
  vulnerabilityCoverage: VulnerabilityCoverage;
  sourceAnalysis?: SourceAnalysisSummary;
  /** Phase 5: empty unless the SPRING_ENDPOINT stage succeeded — check `stages` before reading "none". */
  endpoints: SpringEndpoint[];
  /** Phase 6: size of the call graph the REACHABILITY stage searched; absent when it did not run. */
  callGraph?: CallGraphStats;
  warnings: string[];
}

export interface ScanOrchestratorDeps {
  dependencyAnalyzer: DependencyAnalyzer;
  sbomBuilder: SbomBuilder;
  vulnerabilityProvider: VulnerabilityProvider;
  sourceAnalyzer: JavaSourceAnalyzer;
  /** Defaults to the static Spring MVC annotation analyzer. */
  springEndpointAnalyzer?: Pick<SpringEndpointAnalyzer, 'analyze'>;
  /** Defaults to the Stage A call-graph search. */
  reachabilityAnalyzer?: Pick<ReachabilityAnalyzer, 'analyze'>;
  /** Defaults to the Phase 7 weight table in `@vulntrace/risk`. */
  riskCalculator?: Pick<RiskScoreCalculator, 'calculate'>;
  logger: ScanLogger;
  now?: () => Date;
}

/** Stages not wired into the pipeline yet, with the phase that introduces them. */
const PENDING_STAGES: ReadonlyArray<readonly [ScanStage, string]> = [];

const PROJECT_DETECTION_ERROR_CODES = new Set(['PROJECT_NOT_FOUND', 'UNSUPPORTED_PROJECT']);

const DEFAULT_SCAN_OPTIONS: ScanOptions = { allowMaven: false, checkVulnerabilities: true };

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

function toPackageCoordinate(component: CycloneDxBom['components'][number]): PackageCoordinate {
  return {
    ecosystem: 'Maven',
    name: `${component.group}:${component.name}`,
    version: component.version,
    purl: component.purl,
  };
}

/** Single analysis pipeline shared by the API and the CLI (CLAUDE.md §11). */
export class ScanOrchestrator {
  private readonly now: () => Date;

  constructor(private readonly deps: ScanOrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(projectPath: string, options: ScanOptions = DEFAULT_SCAN_OPTIONS): Promise<ScanReport> {
    const { logger } = this.deps;
    const checkVulnerabilities = options.checkVulnerabilities ?? true;
    const startedAt = this.now().toISOString();
    const stages: ScanStageResult[] = [];
    let project: MavenProjectMetadata | undefined;
    let dependencies: ProjectDependency[] = [];
    let unresolvedDependencies: UnresolvedDependency[] = [];
    let warnings: string[] = [];
    let sbom: CycloneDxBom | undefined;
    let findings: VulnerabilityFinding[] = [];
    const vulnerabilityCoverage: VulnerabilityCoverage = { checked: 0, notChecked: 0, failed: 0 };
    let sourceAnalysis: SourceAnalysisSummary | undefined;
    let javaAnalysis: JavaAnalysisResult | undefined;
    let endpoints: SpringEndpoint[] = [];
    let callGraph: CallGraphStats | undefined;

    logger.info('SCAN', `scan started: ${projectPath}`);

    const analysis = await this.deps.dependencyAnalyzer.analyze(projectPath, options);

    if (!analysis.ok) {
      const reason = `${analysis.error.code}: ${analysis.error.message}`;
      const stage: ScanStage = PROJECT_DETECTION_ERROR_CODES.has(analysis.error.code)
        ? 'PROJECT_DETECTION'
        : 'DEPENDENCY';
      stages.push({ stage, status: 'FAILED', reason });
      logger.error(stage === 'PROJECT_DETECTION' ? 'PROJECT' : 'DEPENDENCY', reason);
      stages.push({ stage: 'SBOM', status: 'SKIPPED', reason: 'no dependency analysis result' });
      stages.push({ stage: 'VULNERABILITY', status: 'SKIPPED', reason: 'no dependency analysis result' });
    } else {
      const result = analysis.value;
      project = result.project;
      dependencies = result.dependencies;
      unresolvedDependencies = result.unresolvedDependencies;
      warnings = result.warnings;
      vulnerabilityCoverage.notChecked = unresolvedDependencies.length;

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

      if (dependencies.length === 0) {
        stages.push({ stage: 'SBOM', status: 'SUCCEEDED' });
        logger.info('SBOM', 'SBOM generated: 0 components');
        stages.push({
          stage: 'VULNERABILITY',
          status: 'SKIPPED',
          reason: 'no resolved dependencies to check',
        });
      } else {
        const sbomResult = this.deps.sbomBuilder.build({
          project,
          dependencies,
          timestamp: this.now().toISOString(),
        });

        if (!sbomResult.ok) {
          const reason = `${sbomResult.error.code}: ${sbomResult.error.message}`;
          stages.push({ stage: 'SBOM', status: 'FAILED', reason });
          logger.error('SBOM', reason);
          stages.push({ stage: 'VULNERABILITY', status: 'SKIPPED', reason: 'SBOM not available' });
        } else {
          sbom = sbomResult.value.bom;
          warnings.push(...sbomResult.value.warnings);
          stages.push({ stage: 'SBOM', status: 'SUCCEEDED' });
          logger.info('SBOM', `SBOM generated: ${sbom.components.length} components`);

          if (!checkVulnerabilities) {
            stages.push({
              stage: 'VULNERABILITY',
              status: 'SKIPPED',
              reason: 'vulnerability check disabled',
            });
            logger.info('VULN', 'vulnerability check skipped: vulnerability check disabled');
          } else {
            const packages = sbom.components.map(toPackageCoordinate);
            vulnerabilityCoverage.checked = packages.length;

            const batch = await this.deps.vulnerabilityProvider.findByPackages(packages);

            if (!batch.ok) {
              const reason = `${batch.error.code}: ${batch.error.message}`;
              stages.push({ stage: 'VULNERABILITY', status: 'FAILED', reason });
              logger.error('VULN', reason);
            } else {
              findings = batch.value.findings;
              warnings.push(...batch.value.warnings);
              vulnerabilityCoverage.failed = batch.value.failedPackages.length;

              const vulnerableDependencyCount = new Set(findings.map((f) => f.package.purl)).size;

              if (batch.value.failedPackages.length > 0) {
                const reason = `${batch.value.failedPackages.length} of ${packages.length} packages failed`;
                stages.push({ stage: 'VULNERABILITY', status: 'FAILED', reason });
                logger.error('VULN', reason);
              } else {
                stages.push({ stage: 'VULNERABILITY', status: 'SUCCEEDED' });
              }
              logger.info(
                'VULN',
                `OSV queried: ${packages.length} packages, ${vulnerableDependencyCount} vulnerable dependencies, ${findings.length} vulnerabilities`,
              );
            }
          }
        }
      }
    }

    if (!project) {
      stages.push({ stage: 'SOURCE_USAGE', status: 'SKIPPED', reason: 'no dependency analysis result' });
    } else {
      const sourceUsage = await this.analyzeSourceUsage(projectPath, dependencies, findings);
      stages.push(sourceUsage.stage);
      if (sourceUsage.stage.status === 'SUCCEEDED') {
        findings = sourceUsage.findings;
        sourceAnalysis = sourceUsage.summary;
        javaAnalysis = sourceUsage.javaAnalysis;
        warnings.push(...sourceUsage.warnings);
      }
    }

    if (!javaAnalysis) {
      stages.push({ stage: 'SPRING_ENDPOINT', status: 'SKIPPED', reason: 'Java source analysis not available' });
    } else {
      const spring = this.analyzeSpringEndpoints(javaAnalysis);
      stages.push(spring.stage);
      endpoints = spring.endpoints;
      warnings.push(...spring.warnings);
    }

    const springSucceeded = stages.some((s) => s.stage === 'SPRING_ENDPOINT' && s.status === 'SUCCEEDED');
    if (!javaAnalysis) {
      stages.push({ stage: 'REACHABILITY', status: 'SKIPPED', reason: 'Java source analysis not available' });
    } else if (!springSucceeded) {
      stages.push({ stage: 'REACHABILITY', status: 'SKIPPED', reason: 'Spring endpoints not available' });
    } else {
      const reachability = this.analyzeReachability(javaAnalysis, endpoints, findings);
      stages.push(reachability.stage);
      findings = reachability.findings;
      callGraph = reachability.callGraph;
      warnings.push(...reachability.warnings);
    }

    const vulnerabilityStage = stages.find((s) => s.stage === 'VULNERABILITY');
    if (!vulnerabilityStage || vulnerabilityStage.status === 'SKIPPED') {
      stages.push({ stage: 'RISK', status: 'SKIPPED', reason: 'no vulnerability check' });
    } else if (vulnerabilityStage.status === 'FAILED' && findings.length === 0) {
      stages.push({ stage: 'RISK', status: 'SKIPPED', reason: 'no vulnerability findings' });
    } else {
      const risk = this.scoreRisk(findings, dependencies, unresolvedDependencies, stages);
      stages.push(risk.stage);
      findings = risk.findings;
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
      sbom,
      findings,
      vulnerabilityCoverage,
      sourceAnalysis,
      endpoints,
      ...(callGraph ? { callGraph } : {}),
      warnings,
    };
  }

  /**
   * RISK (Phase 7): an explainable 0–100 score per finding from whatever earlier stages produced.
   * Factors whose stage did not run score 0 and say so; a failure keeps every earlier result.
   */
  private scoreRisk(
    findings: readonly VulnerabilityFinding[],
    dependencies: readonly ProjectDependency[],
    unresolvedDependencies: readonly UnresolvedDependency[],
    stages: readonly ScanStageResult[],
  ): { stage: ScanStageResult; findings: VulnerabilityFinding[] } {
    const { logger } = this.deps;
    const calculator = this.deps.riskCalculator ?? new RiskScoreCalculator();
    const note = (stage: ScanStage): string | undefined => {
      const result = stages.find((s) => s.stage === stage);
      if (result?.status === 'SUCCEEDED') return undefined;
      return result ? `${result.status}${result.reason ? ` — ${result.reason}` : ''}` : 'not run';
    };
    const sourceUsageNote = note('SOURCE_USAGE');
    const reachabilityNote = note('REACHABILITY');
    const context = {
      dependencies,
      unresolvedDependencies,
      ...(sourceUsageNote ? { sourceUsageNote } : {}),
      ...(reachabilityNote ? { reachabilityNote } : {}),
    };
    try {
      const scored = findings.map((finding): VulnerabilityFinding => ({
        ...finding,
        risk: calculator.calculate(finding, context),
      }));
      const top = [...scored].sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0))[0];
      logger.info(
        'RISK',
        `${scored.length} findings scored${top?.risk ? `, highest ${top.risk.score} (${pickDisplayId(top.vulnerability)} in ${top.package.name})` : ''}`,
      );
      return { stage: { stage: 'RISK', status: 'SUCCEEDED' }, findings: scored };
    } catch (cause) {
      const reason = `risk scoring threw: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.error('RISK', reason);
      return { stage: { stage: 'RISK', status: 'FAILED', reason }, findings: [...findings] };
    }
  }

  /**
   * REACHABILITY (Phase 6): call paths from endpoint handlers to vulnerable API usages, attached
   * to each finding that has a Phase 4 usage result. A failure keeps every earlier result.
   */
  private analyzeReachability(
    javaAnalysis: JavaAnalysisResult,
    endpoints: readonly SpringEndpoint[],
    findings: readonly VulnerabilityFinding[],
  ): { stage: ScanStageResult; findings: VulnerabilityFinding[]; callGraph?: CallGraphStats; warnings: string[] } {
    const { logger } = this.deps;
    const analyzer = this.deps.reachabilityAnalyzer ?? new ReachabilityAnalyzer();
    try {
      const { results, graph, warnings } = analyzer.analyze({ java: javaAnalysis, endpoints, findings });
      const updated = findings.map((finding, i): VulnerabilityFinding => {
        const reachability = results[i];
        return reachability ? { ...finding, reachability } : finding;
      });
      const reachable = updated.filter((f) => f.reachability?.reachable).length;
      const notReachable = updated.filter((f) => f.reachability?.status === 'NOT_REACHABLE').length;
      logger.info(
        'REACHABILITY',
        `call graph: ${graph.methodCount} methods, ${graph.edgeCount} calls, ${graph.unresolvedCallCount} unresolved`,
      );
      logger.info('REACHABILITY', `${reachable} reachable findings, ${notReachable} used but no path found`);
      return { stage: { stage: 'REACHABILITY', status: 'SUCCEEDED' }, findings: updated, callGraph: graph, warnings };
    } catch (cause) {
      const reason = `reachability analysis threw: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.error('REACHABILITY', reason);
      return { stage: { stage: 'REACHABILITY', status: 'FAILED', reason }, findings: [...findings], warnings: [] };
    }
  }

  /**
   * SPRING_ENDPOINT (Phase 5): HTTP entry points from controller annotations in the already
   * parsed MAIN sources. A failure here keeps every earlier result (CLAUDE.md §19).
   */
  private analyzeSpringEndpoints(javaAnalysis: JavaAnalysisResult): {
    stage: ScanStageResult;
    endpoints: SpringEndpoint[];
    warnings: string[];
  } {
    const { logger } = this.deps;
    const analyzer = this.deps.springEndpointAnalyzer ?? new SpringEndpointAnalyzer();
    try {
      const { endpoints, warnings } = analyzer.analyze(javaAnalysis);
      const controllers = new Set(endpoints.map((e) => e.controllerClass)).size;
      const unresolved = endpoints.filter((e) => e.unresolved.length > 0).length;
      logger.info(
        'SPRING',
        `${endpoints.length} endpoints discovered in ${controllers} controllers${unresolved > 0 ? `, ${unresolved} with unresolved parts` : ''}`,
      );
      return { stage: { stage: 'SPRING_ENDPOINT', status: 'SUCCEEDED' }, endpoints, warnings };
    } catch (cause) {
      const reason = `Spring endpoint analysis threw: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.error('SPRING', reason);
      return { stage: { stage: 'SPRING_ENDPOINT', status: 'FAILED', reason }, endpoints: [], warnings: [] };
    }
  }

  /**
   * SOURCE_USAGE (Phase 4): parse Java sources, match them against every resolved dependency,
   * and attach a usage conclusion + evidence to each finding. A failure here keeps all earlier
   * results; findings are then returned without `usage` (CLAUDE.md §19).
   */
  private async analyzeSourceUsage(
    projectPath: string,
    dependencies: readonly ProjectDependency[],
    findings: readonly VulnerabilityFinding[],
  ): Promise<{
    stage: ScanStageResult;
    findings: VulnerabilityFinding[];
    summary?: SourceAnalysisSummary;
    javaAnalysis?: JavaAnalysisResult;
    warnings: string[];
  }> {
    const { logger } = this.deps;
    const failed = (reason: string) => {
      logger.error('SOURCE', reason);
      return {
        stage: { stage: 'SOURCE_USAGE', status: 'FAILED', reason } satisfies ScanStageResult,
        findings: [...findings],
        warnings: [],
      };
    };

    let analysis: Awaited<ReturnType<JavaSourceAnalyzer['analyzeProject']>>;
    try {
      analysis = await this.deps.sourceAnalyzer.analyzeProject(projectPath);
    } catch (cause) {
      return failed(`source analysis threw: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!analysis.ok) return failed(`${analysis.error.code}: ${analysis.error.message}`);

    const { files, skippedFiles, warnings } = analysis.value;
    const dependencyRefs = dependencies.map(({ coordinate }) => ({
      groupId: coordinate.groupId,
      artifactId: coordinate.artifactId,
      purl: coordinate.purl,
    }));
    // Implementations used only through their API (log4j-api → log4j-core) count as used too.
    const dependencyUsages = applyApiImplementations(
      matchDependencyUsages(analysis.value, dependencyRefs),
      dependencyRefs,
    );
    const usageByPurl = new Map(dependencyUsages.map((u) => [u.purl, u]));

    const assessed = findings.map((finding): VulnerabilityFinding => {
      const dependencyUsage = usageByPurl.get(finding.package.purl);
      return dependencyUsage ? { ...finding, usage: assessFindingUsage(finding, dependencyUsage) } : finding;
    });

    const summary: SourceAnalysisSummary = {
      mainFiles: files.filter((f) => f.sourceSet === 'MAIN').length,
      testFiles: files.filter((f) => f.sourceSet === 'TEST').length,
      skippedFiles,
      usedDependencies: dependencyUsages.filter((d) => d.usages.some((u) => u.sourceSet === 'MAIN'))
        .length,
    };
    const usedFindings = assessed.filter((f) => f.usage?.used).length;
    const vulnerableApiFindings = assessed.filter((f) => f.usage?.vulnerableApi === 'USED').length;

    logger.info(
      'SOURCE',
      `${files.length} Java files analyzed (${summary.mainFiles} main, ${summary.testFiles} test, ${skippedFiles.length} skipped)`,
    );
    logger.info('SOURCE', `${summary.usedDependencies} dependencies used by source`);
    logger.info(
      'SOURCE',
      `${usedFindings} of ${assessed.length} findings used, ${vulnerableApiFindings} with vulnerable API usage`,
    );

    return {
      stage: { stage: 'SOURCE_USAGE', status: 'SUCCEEDED' },
      findings: assessed,
      summary,
      javaAnalysis: analysis.value,
      warnings,
    };
  }
}
