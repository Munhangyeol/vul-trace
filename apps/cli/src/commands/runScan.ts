import { resolve } from 'node:path';
import type { ScanOrchestrator, ScanReport } from '@vulntrace/core';

/** Runs the shared pipeline and sets a non-zero exit code when the scan failed. */
export async function runScan(orchestrator: ScanOrchestrator, path: string): Promise<ScanReport> {
  const report = await orchestrator.run(resolve(path));
  if (report.state === 'FAILED') process.exitCode = 1;
  return report;
}
