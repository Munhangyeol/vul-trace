import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies, renderSummary, renderVulnerabilities } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';

interface ReportCliOptions extends MavenCliOptions, VulnerabilityCliOptions {
  json?: boolean;
}

export function registerReportCommand(program: Command, orchestrator: ScanOrchestrator): void {
  const command = program
    .command('report')
    .description('Print the full scan report (summary, dependencies, vulnerabilities, unresolved)')
    .argument('<path>', 'path to the project root')
    .option('--json', 'print the full ScanReport as JSON instead of text');
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (path: string, options: ReportCliOptions) => {
    const report = await runScan(orchestrator, path, {
      ...parseMavenOptions(options),
      ...parseVulnerabilityOptions(options),
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(
      [renderSummary(report), renderDependencies(report), renderVulnerabilities(report)].join(
        '\n\n',
      ),
    );
  });
}
