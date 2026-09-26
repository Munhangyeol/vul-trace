import { readFileSync } from 'node:fs';
import type {
  AnalysisError,
  ProjectDependency,
  Result,
  UnresolvedDependency,
} from '@vulntrace/shared';
import { AnalysisError as AnalysisErrorClass, err, ok } from '@vulntrace/shared';
import { mergeDependencies } from './mergeDependencies.js';
import { MavenProjectDetector } from './MavenProjectDetector.js';
import { PomParser } from './pom/PomParser.js';
import { resolvePomDependencies } from './pom/resolvePomDependencies.js';
import { NodeProcessRunner } from './process/ProcessRunner.js';
import type { ProcessRunner } from './process/ProcessRunner.js';
import { DependencyTreeParser } from './tree/DependencyTreeParser.js';
import { MavenDependencyTreeRunner } from './tree/MavenDependencyTreeRunner.js';

export interface MavenProjectMetadata {
  groupId: string;
  artifactId: string;
  version: string;
  pomPath: string;
}

export interface DependencyAnalysisOptions {
  allowMaven: boolean;
  mavenTimeoutMs?: number;
}

export type TransitiveResolutionStatus = 'RESOLVED' | 'SKIPPED' | 'FAILED';

export interface TransitiveResolution {
  status: TransitiveResolutionStatus;
  reason?: string;
}

export interface DependencyAnalysisResult {
  project: MavenProjectMetadata;
  dependencies: ProjectDependency[];
  unresolvedDependencies: UnresolvedDependency[];
  transitive: TransitiveResolution;
  warnings: string[];
}

export interface DependencyAnalyzer {
  analyze(
    projectPath: string,
    options?: DependencyAnalysisOptions,
  ): Promise<Result<DependencyAnalysisResult, AnalysisError>>;
}

const DEFAULT_OPTIONS: DependencyAnalysisOptions = { allowMaven: false };

/** Phase 1: pom.xml detection/parsing + optional `mvn dependency:tree` (CLAUDE.md §7 Phase 1). */
export class MavenDependencyAnalyzer implements DependencyAnalyzer {
  private readonly detector = new MavenProjectDetector();
  private readonly pomParser = new PomParser();
  private readonly treeParser = new DependencyTreeParser();
  private readonly treeRunner: MavenDependencyTreeRunner;

  constructor(processRunner: ProcessRunner = new NodeProcessRunner()) {
    this.treeRunner = new MavenDependencyTreeRunner(processRunner);
  }

  async analyze(
    projectPath: string,
    options: DependencyAnalysisOptions = DEFAULT_OPTIONS,
  ): Promise<Result<DependencyAnalysisResult, AnalysisError>> {
    const detection = this.detector.detect(projectPath);
    if (!detection.ok) return err(detection.error);
    const { pomPath, warnings: detectionWarnings } = detection.value;

    let pomXml: string;
    try {
      pomXml = readFileSync(pomPath, 'utf-8');
    } catch (cause) {
      return err(
        new AnalysisErrorClass('PARSE_ERROR', `Failed to read pom.xml: ${pomPath}`, { cause }),
      );
    }

    const parsed = this.pomParser.parse(pomXml, pomPath);
    if (!parsed.ok) return err(parsed.error);
    const pom = parsed.value;

    const groupId = pom.groupId ?? pom.parent?.groupId;
    const version = pom.version ?? pom.parent?.version;
    if (!groupId || !version) {
      return err(
        new AnalysisErrorClass(
          'PARSE_ERROR',
          `pom.xml is missing a resolvable groupId/version: ${pomPath}`,
        ),
      );
    }

    const project: MavenProjectMetadata = { groupId, artifactId: pom.artifactId, version, pomPath };
    const { resolved: pomResolved, unresolved: pomUnresolved } = resolvePomDependencies(pom, {
      kind: 'pom.xml',
      filePath: pomPath,
    });

    const warnings = [...detectionWarnings];

    if (!options.allowMaven) {
      const merged = mergeDependencies({
        pomFilePath: pomPath,
        treeFilePath: '',
        pomResolved,
        pomUnresolved,
        treeNodes: [],
      });
      return ok({
        project,
        dependencies: merged.dependencies,
        unresolvedDependencies: merged.unresolvedDependencies,
        transitive: { status: 'SKIPPED', reason: 'maven execution not allowed' },
        warnings: [...warnings, ...merged.warnings],
      });
    }

    const treeResult = await this.treeRunner.run(detection.value.projectRoot, {
      timeoutMs: options.mavenTimeoutMs,
    });

    if (!treeResult.ok) {
      const merged = mergeDependencies({
        pomFilePath: pomPath,
        treeFilePath: '',
        pomResolved,
        pomUnresolved,
        treeNodes: [],
      });
      return ok({
        project,
        dependencies: merged.dependencies,
        unresolvedDependencies: merged.unresolvedDependencies,
        transitive: { status: 'FAILED', reason: treeResult.error.message },
        warnings: [...warnings, ...merged.warnings],
      });
    }

    const treeParse = this.treeParser.parse(treeResult.value);
    for (const parseError of treeParse.errors) {
      warnings.push(
        `dependency:tree line ${parseError.line} not recognized: ${parseError.content}`,
      );
    }

    const merged = mergeDependencies({
      pomFilePath: pomPath,
      treeFilePath: `${pomPath}#dependency-tree`,
      pomResolved,
      pomUnresolved,
      treeNodes: treeParse.nodes,
    });

    return ok({
      project,
      dependencies: merged.dependencies,
      unresolvedDependencies: merged.unresolvedDependencies,
      transitive: { status: 'RESOLVED' },
      warnings: [...warnings, ...merged.warnings],
    });
  }
}
