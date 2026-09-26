import { resolve } from 'node:path';
import type { ScanOptions, ScanOrchestrator, ScanReport } from '@vulntrace/core';

const DEFAULT_OPTIONS: ScanOptions = { allowMaven: false, checkVulnerabilities: true };

/** Runs the shared pipeline and sets a non-zero exit code when the scan failed. */
export async function runScan(
  orchestrator: ScanOrchestrator,
  path: string,
  options: ScanOptions = DEFAULT_OPTIONS,
): Promise<ScanReport> {
  const report = await orchestrator.run(resolve(path), options);
  if (report.state === 'FAILED') process.exitCode = 1;
  return report;
}
