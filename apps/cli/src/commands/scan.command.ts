import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies, renderSummary, renderVulnerabilities } from '../render/text-report.js';
import { runScan } from './runScan.js';

export function registerScanCommand(program: Command, orchestrator: ScanOrchestrator): void {
  program
    .command('scan')
    .description('Scan a local Maven project and print a summary')
    .argument('<path>', 'path to the project root')
    .action(async (path: string) => {
      const report = await runScan(orchestrator, path);
      console.log(
        [renderSummary(report), renderDependencies(report), renderVulnerabilities(report)].join(
          '\n\n',
        ),
      );
    });
}
