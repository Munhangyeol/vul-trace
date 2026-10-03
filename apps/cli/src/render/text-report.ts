import { basename } from 'node:path';
import { compareFindings, pickDisplayId, summarizeScan } from '@vulntrace/core';
import type { ScanReport } from '@vulntrace/core';
import type { ScanStage } from '@vulntrace/shared';

function stageNote(report: ScanReport, stage: ScanStage): string | undefined {
  const result = report.stages.find((s) => s.stage === stage);
  if (!result || result.status === 'SUCCEEDED') return undefined;
  return `${result.status}${result.reason ? ` — ${result.reason}` : ''}`;
}

const SUMMARY_LABEL_WIDTH = 19;

/** The CLAUDE.md §7 Phase 3 summary block: Project / State / Dependencies / Vulnerabilities / Critical / High. */
export function renderSummary(report: ScanReport): string {
  const summary = summarizeScan(report);
  const lines = [`Project: ${basename(report.projectPath)}`, `State:   ${report.state}`, ''];

  const detectionNote = stageNote(report, 'PROJECT_DETECTION') ?? stageNote(report, 'DEPENDENCY');
  if (detectionNote) {
    lines.push(`Dependencies: unavailable (${detectionNote})`);
  } else {
    const unresolvedNote =
      summary.unresolved > 0 ? `   (${summary.unresolved} unresolved — not checked)` : '';
    lines.push(
      `${'Dependencies:'.padEnd(SUMMARY_LABEL_WIDTH)}${summary.dependencies}${unresolvedNote}`,
      `${'Vulnerabilities:'.padEnd(SUMMARY_LABEL_WIDTH)}${summary.vulnerabilities}`,
      `${'Critical:'.padEnd(SUMMARY_LABEL_WIDTH)}${summary.bySeverity.CRITICAL}`,
      `${'High:'.padEnd(SUMMARY_LABEL_WIDTH)}${summary.bySeverity.HIGH}`,
    );

    const vulnerabilityNote = stageNote(report, 'VULNERABILITY');
    if (vulnerabilityNote) lines.push('', `Warning: ${vulnerabilityNote}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', ...report.warnings.map((w) => `  - ${w}`));
  }

  return lines.join('\n');
}

/** Just the sorted vulnerability table — no coverage note, no unresolved-dependency detail. */
export function renderVulnerabilityTable(report: ScanReport): string {
  if (report.findings.length === 0) return '';

  const lines = ['ID               Severity  CVSS  Dependency                                Fixed'];
  for (const finding of [...report.findings].sort(compareFindings)) {
    const displayId = pickDisplayId(finding.vulnerability);
    const cvss =
      finding.vulnerability.cvssScore !== undefined ? finding.vulnerability.cvssScore.toFixed(1) : '-';
    const dependency = `${finding.package.name}@${finding.package.version}`;
    const fixed = finding.fixedVersions.length > 0 ? finding.fixedVersions.join(', ') : 'no fix';
    lines.push(
      [displayId.padEnd(16), finding.vulnerability.severity.padEnd(9), cvss.padEnd(5), dependency.padEnd(40), fixed].join(
        ' ',
      ),
    );
    if (finding.vulnerability.id !== displayId) {
      lines.push(`  (${finding.vulnerability.id})`);
    }
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
  if (note && report.findings.length === 0) {
    return `Vulnerabilities: unavailable (${note})`;
  }

  const { checked, notChecked, failed } = report.vulnerabilityCoverage;
  const coverageParts = [
    `checked ${checked} dependencies`,
    notChecked > 0 ? `${notChecked} not checked` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
  ].filter((p): p is string => p !== undefined);

  const lines = [`Vulnerabilities: ${report.findings.length}   (${coverageParts.join(', ')})`];
  if (note) lines.push(`Warning: ${note}`);

  const table = renderVulnerabilityTable(report);
  if (table) lines.push(table);

  if (report.unresolvedDependencies.length > 0) {
    lines.push(
      '',
      `Not checked (version unresolved): ${report.unresolvedDependencies.length}`,
      ...report.unresolvedDependencies.map((u) =>
        [
          u.groupId + ':' + u.artifactId + (u.rawVersion ? `@${u.rawVersion}` : ''),
          u.reason,
        ].join('   '),
      ),
    );
  }

  return lines.join('\n');
}
