import { existsSync, writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { ScanOrchestrator } from '@vulntrace/core';
import { renderDependencies, renderSummary, renderVulnerabilities } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';

interface ScanCliOptions extends MavenCliOptions, VulnerabilityCliOptions {
  sbom?: string;
  force?: boolean;
}

export function registerScanCommand(program: Command, orchestrator: ScanOrchestrator): void {
  const command = program
    .command('scan')
    .description('Scan a local Maven project and print a summary')
    .argument('<path>', 'path to the project root')
    .option('--sbom <file>', 'write the generated CycloneDX SBOM as JSON to this file')
    .option('--force', 'with --sbom, overwrite the output file if it already exists');
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (path: string, options: ScanCliOptions) => {
    const report = await runScan(orchestrator, path, {
      ...parseMavenOptions(options),
      ...parseVulnerabilityOptions(options),
    });

    if (options.sbom) {
      if (!report.sbom) {
        console.error(`Cannot write --sbom: no SBOM was generated (see stage status below)`);
        process.exitCode = 1;
      } else if (existsSync(options.sbom) && !options.force) {
        console.error(`Refusing to overwrite existing file: ${options.sbom} (use --force)`);
        process.exitCode = 1;
      } else {
        writeFileSync(options.sbom, JSON.stringify(report.sbom, null, 2));
      }
    }

    console.log(
      [renderSummary(report), renderDependencies(report), renderVulnerabilities(report)].join(
        '\n\n',
      ),
    );
  });
}
