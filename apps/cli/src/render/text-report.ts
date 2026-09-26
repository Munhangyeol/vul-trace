import type { ScanReport } from '@vulntrace/core';
import type { ScanStage } from '@vulntrace/shared';
import { basename } from 'node:path';

function stageNote(report: ScanReport, stage: ScanStage): string | undefined {
  const result = report.stages.find((s) => s.stage === stage);
  if (!result || result.status === 'SUCCEEDED') return undefined;
  return `${result.status}${result.reason ? ` — ${result.reason}` : ''}`;
}

export function renderSummary(report: ScanReport): string {
  const lines = [
    `Project: ${basename(report.projectPath)}`,
    `Path:    ${report.projectPath}`,
    `State:   ${report.state}`,
    '',
    'Stages:',
    ...report.stages.map(
      (s) => `  ${s.stage.padEnd(18)} ${s.status}${s.reason ? `  (${s.reason})` : ''}`,
    ),
  ];
  return lines.join('\n');
}

export function renderDependencies(report: ScanReport): string {
  const note = stageNote(report, 'DEPENDENCY');
  if (note) return `Dependencies: unavailable (${note})`;

  const rows = report.dependencies.map(({ coordinate: c }) =>
    [c.direct ? 'direct    ' : 'transitive', c.scope.padEnd(8), c.purl].join('  '),
  );
  return [`Dependencies: ${report.dependencies.length}`, ...rows].join('\n');
}

export function renderVulnerabilities(report: ScanReport): string {
  const note = stageNote(report, 'VULNERABILITY');
  return `Vulnerabilities: unavailable (${note ?? 'no findings recorded'})`;
}
