export { ScanOrchestrator, deriveScanState } from './ScanOrchestrator.js';
export type {
  ScanOptions,
  ScanOrchestratorDeps,
  ScanReport,
  ScanReportSource,
  SourceAnalysisSummary,
} from './ScanOrchestrator.js';
export { RepositoryScanRunner, relativizeReportPaths } from './RepositoryScanRunner.js';
export type { GitRepositoryPort, RepositoryScanRunnerDeps } from './RepositoryScanRunner.js';
export {
  looksLikeRepositoryUrl,
  parseGitHubRepositoryUrl,
  validateGitRef,
} from '@vulntrace/repository-source';
export type { RepositoryTarget } from '@vulntrace/repository-source';
export type { DependencyAnalysisOptions } from '@vulntrace/dependency-analyzer';
export { createRepositoryScanRunner, createScanOrchestrator } from './createScanOrchestrator.js';
export { createConsoleScanLogger, silentScanLogger } from './logging/ScanLogger.js';
export type { ScanLogger, ScanLogTag } from './logging/ScanLogger.js';
export type { ProjectRepository } from './ports/ProjectRepository.js';
export type { ScanRepository } from './ports/ScanRepository.js';
export type { FindingRepository, StoredFinding } from './ports/FindingRepository.js';
export type { EndpointRepository } from './ports/EndpointRepository.js';
export { summarizeScan } from './summary/summarizeScan.js';
export type { ScanSummary, ScanSummaryInput } from './summary/summarizeScan.js';
export { compareFindings, pickDisplayId, SEVERITY_RANK } from './summary/findingOrder.js';
