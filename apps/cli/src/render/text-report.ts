import { basename } from 'node:path';
import type { ScanReport } from '@vulntrace/core';
import type { ScanStage } from '@vulntrace/shared';

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
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', ...report.warnings.map((w) => `  - ${w}`));
  }
  return lines.join('\n');
}

export function renderDependencies(report: ScanReport): string {
  const detectionNote = stageNote(report, 'PROJECT_DETECTION');
  if (detectionNote) return `Dependencies: unavailable (${detectionNote})`;

  const note = stageNote(report, 'DEPENDENCY');
  if (note) return `Dependencies: unavailable (${note})`;

  const rows = report.dependencies.map(({ coordinate: c, source }) =>
    [
      (c.direct ? 'direct' : 'transitive').padEnd(10),
      c.scope.padEnd(8),
      c.purl.padEnd(50),
      `(${source.kind})`,
    ].join('  '),
  );
  const lines = [`Dependencies: ${report.dependencies.length}`, ...rows];

  const treeNote = stageNote(report, 'DEPENDENCY_TREE');
  if (treeNote) lines.push(`Transitive resolution: ${treeNote}`);

  if (report.unresolvedDependencies.length > 0) {
    const unresolvedRows = report.unresolvedDependencies.map((u) =>
      [
        'direct'.padEnd(10),
        u.scope.padEnd(8),
        `${u.groupId}:${u.artifactId}${u.rawVersion ? `@${u.rawVersion}` : ''}`.padEnd(50),
        `${u.reason} (not resolved)`,
      ].join('  '),
    );
    lines.push(`Unresolved: ${report.unresolvedDependencies.length}`, ...unresolvedRows);
  }

  return lines.join('\n');
}

export function renderVulnerabilities(report: ScanReport): string {
  const note = stageNote(report, 'VULNERABILITY');
  return `Vulnerabilities: unavailable (${note ?? 'no findings recorded'})`;
}
