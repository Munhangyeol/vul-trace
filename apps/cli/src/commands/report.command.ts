import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import {
  renderDependencies,
  renderEndpoints,
  renderSourceUsage,
  renderSummary,
  renderVulnerabilities,
} from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface ReportCliOptions extends SourceCliOptions, MavenCliOptions, VulnerabilityCliOptions {
  json?: boolean;
}

export function registerReportCommand(program: Command, runner: RepositoryScanRunner): void {
  const command = program
    .command('report')
    .description('Print the full scan report (summary, dependencies, vulnerabilities, source usage evidence, Spring endpoints)')
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--json', 'print the full ScanReport as JSON instead of text');
  addSourceOptions(command);
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (target: string, options: ReportCliOptions) => {
    const report = await runScan(runner, target, {
      ...parseMavenOptions(options),
      ...parseVulnerabilityOptions(options),
    }, options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(
      [
        renderSummary(report),
        renderDependencies(report),
        renderVulnerabilities(report),
        renderSourceUsage(report),
        renderEndpoints(report),
      ].join('\n\n'),
    );
  });
}
