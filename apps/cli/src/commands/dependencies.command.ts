import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { runScan } from './runScan.js';

interface DependenciesCliOptions extends MavenCliOptions {
  json?: boolean;
}

export function registerDependenciesCommand(
  program: Command,
  orchestrator: ScanOrchestrator,
): void {
  const command = program
    .command('dependencies')
    .description('List direct and transitive dependencies of a local Maven project')
    .argument('<path>', 'path to the project root')
    .option('--json', 'print the full scan report as JSON');
  addMavenOptions(command);

  command.action(async (path: string, options: DependenciesCliOptions) => {
    const report = await runScan(orchestrator, path, {
      ...parseMavenOptions(options),
      checkVulnerabilities: false,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : renderDependencies(report));
  });
}
