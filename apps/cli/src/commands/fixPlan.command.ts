import type { Command } from 'commander';
import type { RepositoryScanRunner } from '@vulntrace/core';
import { planRemediation } from '@vulntrace/core';
import { renderFixPlan } from '../render/text-report.js';
import { addMavenOptions, parseMavenOptions } from './mavenOptions.js';
import type { MavenCliOptions } from './mavenOptions.js';
import { runScan } from './runScan.js';
import { addSourceOptions, TARGET_ARGUMENT_DESCRIPTION } from './sourceOptions.js';
import type { SourceCliOptions } from './sourceOptions.js';

interface FixPlanCliOptions extends SourceCliOptions, MavenCliOptions {
  json?: boolean;
}

/** Phase 8: which version to upgrade each vulnerable dependency to, and what that fixes. */
export function registerFixPlanCommand(program: Command, runner: RepositoryScanRunner): void {
  const command = program
    .command('fix-plan')
    .description('Scan, then print one upgrade recommendation per vulnerable dependency, highest risk first')
    .argument('<target>', TARGET_ARGUMENT_DESCRIPTION)
    .option('--json', 'print the plan as JSON');
  addSourceOptions(command);
  addMavenOptions(command);

  command.action(async (target: string, options: FixPlanCliOptions) => {
    // Remediation needs vulnerability data, so OSV is always queried here.
    const report = await runScan(runner, target, { ...parseMavenOptions(options), checkVulnerabilities: true }, options);
    if (options.json) {
      const plan = planRemediation({ findings: report.findings.map((finding) => ({ finding })), dependencies: report.dependencies });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(renderFixPlan(report));
  });
}
