import type { RepositoryScanRunner, ScanOptions, ScanReport } from '@vulntrace/core';
import { toScanTarget } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

const DEFAULT_OPTIONS: ScanOptions = { allowMaven: false, checkVulnerabilities: true };

/** Runs the shared pipeline and sets a non-zero exit code when the scan failed. */
export async function runScan(
  runner: RepositoryScanRunner,
  input: string,
  options: ScanOptions = DEFAULT_OPTIONS,
  source: SourceCliOptions = {},
): Promise<ScanReport> {
  const target = toScanTarget(input, source);
  if ('error' in target) {
    console.error(`error: ${target.error}`);
    process.exit(2);
  }
  const report = await runner.run(target, options);
  if (report.state === 'FAILED') process.exitCode = 1;
  return report;
}
