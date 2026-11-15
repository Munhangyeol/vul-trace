import { existsSync, writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import { renderSummary, renderVulnerabilityTable } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { addVulnerabilityOptions, parseVulnerabilityOptions } from './vulnerabilityOptions.js';
import type { VulnerabilityCliOptions } from './vulnerabilityOptions.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface ScanCliOptions extends SourceCliOptions, MavenCliOptions, VulnerabilityCliOptions {
  sbom?: string;
  force?: boolean;
}

export function registerScanCommand(program: Command, runner: RepositoryScanRunner): void {
  const command = program
    .command('scan')
    .description('Scan a Maven project (local path or GitHub repository) and print a summary')
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--sbom <file>', 'write the generated CycloneDX SBOM as JSON to this file')
    .option('--force', 'with --sbom, overwrite the output file if it already exists');
  addSourceOptions(command);
  addMavenOptions(command);
  addVulnerabilityOptions(command);

  command.action(async (target: string, options: ScanCliOptions) => {
    const report = await runScan(
      runner,
      target,
      {
        ...parseMavenOptions(options),
        ...parseVulnerabilityOptions(options),
      },
      options,
    );

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

    const table = renderVulnerabilityTable(report);
    console.log([renderSummary(report), table].filter((part) => part !== '').join('\n\n'));
  });
}
