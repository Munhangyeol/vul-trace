import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import { renderVulnerabilities } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface VulnerabilitiesCliOptions
  extends SourceCliOptions, MavenCliOptions, VulnerabilityCliOptions {
  json?: boolean;
}

export function registerVulnerabilitiesCommand(
  program: Command,
  runner: RepositoryScanRunner,
): void {
  const command = program
    .command('vulnerabilities')
    .description(
      'List vulnerability findings of a Maven project (local path or GitHub repository) (queries OSV; package coordinates are sent to api.osv.dev unless --skip-vulnerabilities is set)',
    )
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--json', 'print the full scan report as JSON');
  addSourceOptions(command);
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (target: string, options: VulnerabilitiesCliOptions) => {
    const report = await runScan(
      runner,
      target,
      {
        ...parseMavenOptions(options),
        ...parseVulnerabilityOptions(options),
      },
      options,
    );
    console.log(options.json ? JSON.stringify(report, null, 2) : renderVulnerabilities(report));
  });
}
