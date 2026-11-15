import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import { renderDependencies } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface DependenciesCliOptions extends SourceCliOptions, MavenCliOptions {
  json?: boolean;
}

export function registerDependenciesCommand(program: Command, runner: RepositoryScanRunner): void {
  const command = program
    .command('dependencies')
    .description(
      'List direct and transitive dependencies of a Maven project (local path or GitHub repository)',
    )
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--json', 'print the full scan report as JSON');
  addSourceOptions(command);
  addMavenOptions(command);

  command.action(async (target: string, options: DependenciesCliOptions) => {
    const report = await runScan(
      runner,
      target,
      {
        ...parseMavenOptions(options),
        checkVulnerabilities: false,
      },
      options,
    );
    console.log(options.json ? JSON.stringify(report, null, 2) : renderDependencies(report));
  });
}
