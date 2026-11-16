import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import { renderEndpoints } from '../render/text-report.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface EndpointsCliOptions extends SourceCliOptions {
  json?: boolean;
}

export function registerEndpointsCommand(program: Command, runner: RepositoryScanRunner): void {
  const command = program
    .command('endpoints')
    .description('List Spring MVC endpoints (HTTP method, path, controller method) found in the source')
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--json', 'print the discovered endpoints as JSON');
  addSourceOptions(command);

  command.action(async (target: string, options: EndpointsCliOptions) => {
    // Endpoints come from source only: no Maven, no OSV.
    const report = await runScan(runner, target, { allowMaven: false, checkVulnerabilities: false }, options);
    console.log(options.json ? JSON.stringify(report.endpoints, null, 2) : renderEndpoints(report));
  });
}
