import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { runScan } from './runScan.js';

export function registerReportCommand(program: Command, orchestrator: ScanOrchestrator): void {
  program
    .command('report')
    .description('Print the full scan report as JSON')
    .argument('<path>', 'path to the project root')
    .action(async (path: string) => {
      const report = await runScan(orchestrator, path);
      console.log(JSON.stringify(report, null, 2));
    });
}
