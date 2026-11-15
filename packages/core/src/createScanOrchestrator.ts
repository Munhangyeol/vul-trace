import { MavenDependencyAnalyzer, NodeProcessRunner } from '@vulntrace/dependency-analyzer';
import { GitRepositorySource, LocalPathSource } from '@vulntrace/repository-source';
import type { GitRepositorySourceOptions } from '@vulntrace/repository-source';
import { CycloneDxBuilder } from '@vulntrace/sbom';
import { LightweightJavaSourceAnalyzer } from '@vulntrace/source-analyzer';
import { OsvVulnerabilityProvider } from '@vulntrace/vulnerability';
import type { ScanLogger } from './logging/ScanLogger.js';
import { RepositoryScanRunner } from './RepositoryScanRunner.js';
import type { GitRepositoryPort } from './RepositoryScanRunner.js';
import { ScanOrchestrator } from './ScanOrchestrator.js';

/** Default wiring used by both apps/api and apps/cli. */
export function createScanOrchestrator(options: { logger: ScanLogger }): ScanOrchestrator {
  return new ScanOrchestrator({
    dependencyAnalyzer: new MavenDependencyAnalyzer(),
    sbomBuilder: new CycloneDxBuilder(),
    vulnerabilityProvider: new OsvVulnerabilityProvider(),
    sourceAnalyzer: new LightweightJavaSourceAnalyzer(),
    logger: options.logger,
  });
}

/**
 * Default runner used by both apps: local folders in place, GitHub repositories via a hardened
 * shallow clone. `gitSource` can be replaced (tests use a fake that never touches the network).
 */
export function createRepositoryScanRunner(options: {
  logger: ScanLogger;
  git?: GitRepositorySourceOptions;
  gitSource?: GitRepositoryPort;
}): RepositoryScanRunner {
  return new RepositoryScanRunner({
    orchestrator: createScanOrchestrator({ logger: options.logger }),
    localSource: new LocalPathSource(),
    gitSource: options.gitSource ?? new GitRepositorySource(new NodeProcessRunner(), options.git),
    logger: options.logger,
  });
}
