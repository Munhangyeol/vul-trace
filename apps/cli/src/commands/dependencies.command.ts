import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies } from '../render/text-report.js';
import { runScan } from './runScan.js';

export function registerDependenciesCommand(program: Command, orchestrator: ScanOrchestrator): void {
  program
    .command('dependencies')
    .description('List direct and transitive dependencies of a local Maven project')
    .argument('<path>', 'path to the project root')
    .action(async (path: string) => {
      const report = await runScan(orchestrator, path);
      console.log(renderDependencies(report));
    });
}
