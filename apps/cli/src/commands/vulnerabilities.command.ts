import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderVulnerabilities } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';

interface VulnerabilitiesCliOptions extends MavenCliOptions, VulnerabilityCliOptions {
  json?: boolean;
}

export function registerVulnerabilitiesCommand(
  program: Command,
  orchestrator: ScanOrchestrator,
): void {
  const command = program
    .command('vulnerabilities')
    .description(
      'List vulnerability findings of a local Maven project (queries OSV; package coordinates are sent to api.osv.dev unless --skip-vulnerabilities is set)',
    )
    .argument('<path>', 'path to the project root')
    .option('--json', 'print the full scan report as JSON');
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (path: string, options: VulnerabilitiesCliOptions) => {
    const report = await runScan(orchestrator, path, {
      ...parseMavenOptions(options),
      ...parseVulnerabilityOptions(options),
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : renderVulnerabilities(report));
  });
}
