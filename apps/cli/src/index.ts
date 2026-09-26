#!/usr/bin/env node
import { Command } from 'commander';
import { createConsoleScanLogger, createScanOrchestrator } from '@vulntrace/core';
import { registerDependenciesCommand } from './commands/dependencies.command.js';
import { registerReportCommand } from './commands/report.command.js';
import { registerScanCommand } from './commands/scan.command.js';
import { registerVulnerabilitiesCommand } from './commands/vulnerabilities.command.js';

// Logs go to stderr so stdout stays clean for report output.
const orchestrator = createScanOrchestrator({ logger: createConsoleScanLogger() });

const program = new Command()
  .name('vulntrace')
  .description('Vulnerability analysis and prioritization for Java / Spring Boot / Maven projects')
  .version('0.0.0');

registerScanCommand(program, orchestrator);
registerDependenciesCommand(program, orchestrator);
registerVulnerabilitiesCommand(program, orchestrator);
registerReportCommand(program, orchestrator);

// `pnpm <script> -- <args>` forwards the separator literally; drop it.
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();

await program.parseAsync(args, { from: 'user' });
