import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderVulnerabilities } from '../render/text-report.js';
import { runScan } from './runScan.js';

export function registerVulnerabilitiesCommand(
  program: Command,
  orchestrator: ScanOrchestrator,
): void {
  program
    .command('vulnerabilities')
    .description('List vulnerability findings of a local Maven project')
    .argument('<path>', 'path to the project root')
    .action(async (path: string) => {
      const report = await runScan(orchestrator, path);
      console.log(renderVulnerabilities(report));
    });
}
