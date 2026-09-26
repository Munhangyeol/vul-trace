import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies, renderSummary, renderVulnerabilities } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { runScan } from './runScan.js';

export function registerScanCommand(program: Command, orchestrator: ScanOrchestrator): void {
  const command = program
    .command('scan')
    .description('Scan a local Maven project and print a summary')
    .argument('<path>', 'path to the project root');
  addMavenOptions(command);

  command.action(async (path: string, options: MavenCliOptions) => {
    const report = await runScan(orchestrator, path, parseMavenOptions(options));
    console.log(
      [renderSummary(report), renderDependencies(report), renderVulnerabilities(report)].join(
        '\n\n',
      ),
    );
  });
}
