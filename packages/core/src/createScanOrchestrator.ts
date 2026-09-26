import { MavenDependencyAnalyzer } from '@vulntrace/dependency-analyzer';
import { CycloneDxBuilder } from '@vulntrace/sbom';
import { OsvVulnerabilityProvider } from '@vulntrace/vulnerability';
import type { ScanLogger } from './logging/ScanLogger.js';
import { ScanOrchestrator } from './ScanOrchestrator.js';

/** Default wiring used by both apps/api and apps/cli. */
export function createScanOrchestrator(options: { logger: ScanLogger }): ScanOrchestrator {
  return new ScanOrchestrator({
    dependencyAnalyzer: new MavenDependencyAnalyzer(),
    sbomBuilder: new CycloneDxBuilder(),
    vulnerabilityProvider: new OsvVulnerabilityProvider(),
    logger: options.logger,
  });
}
