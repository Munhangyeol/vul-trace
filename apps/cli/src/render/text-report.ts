import { basename } from 'node:path';
import { compareFindings, pickDisplayId, summarizeScan } from '@vulntrace/core';
import type { ScanReport } from '@vulntrace/core';
import type { FindingUsage, ScanStage, VulnerabilityFinding } from '@vulntrace/shared';

function stageNote(report: ScanReport, stage: ScanStage): string | undefined {
  const result = report.stages.find((s) => s.stage === stage);
  if (!result || result.status === 'SUCCEEDED') return undefined;
  return `${result.status}${result.reason ? ` — ${result.reason}` : ''}`;
}

const SUMMARY_LABEL_WIDTH = 19;

/** The CLAUDE.md §7 Phase 3 summary block: Project / State / Dependencies / Vulnerabilities / Critical / High. */
export function renderSummary(report: ScanReport): string {
  const summary = summarizeScan(report);
  const lines = [`Project: ${basename(report.projectPath)}`];
  if (report.source?.type === 'GIT') {
    const { repoUrl, ref, commitSha } = report.source;
    lines.push(`Source:  ${repoUrl}${ref ? ` (${ref})` : ''} @ ${commitSha ?? 'not fetched'}`);
  }
  lines.push(`State:   ${report.state}`, '');

  const detectionNote =
    stageNote(report, 'REPOSITORY_FETCH') ??
    stageNote(report, 'PROJECT_DETECTION') ??
    stageNote(report, 'DEPENDENCY');
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
      `${'Used by source:'.padEnd(SUMMARY_LABEL_WIDTH)}${
        summary.usedVulnerabilities ?? `unavailable (${stageNote(report, 'SOURCE_USAGE') ?? 'not analyzed'})`
      }`,
      `${'Endpoints:'.padEnd(SUMMARY_LABEL_WIDTH)}${endpointCount(report)}`,
    );

    const vulnerabilityNote = stageNote(report, 'VULNERABILITY');
    if (vulnerabilityNote) lines.push('', `Warning: ${vulnerabilityNote}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', ...report.warnings.map((w) => `  - ${w}`));
  }

  return lines.join('\n');
}

/** "0" only when the SPRING_ENDPOINT stage actually ran; otherwise the count is unknown. */
function endpointCount(report: ScanReport): string {
  const note = stageNote(report, 'SPRING_ENDPOINT');
  return note ? `unavailable (${note})` : String(report.endpoints.length);
}

const VULNERABLE_API_LABEL: Record<FindingUsage['vulnerableApi'], string> = {
  USED: 'used',
  NOT_DETECTED: 'not detected',
  NO_API_INFO: 'no info',
};

function usedLabel(finding: VulnerabilityFinding): string {
  if (!finding.usage) return '-';
  if (!finding.usage.used) return 'no';
  return finding.usage.viaApi ? 'via API' : 'yes';
}

function vulnerableApiLabel(finding: VulnerabilityFinding): string {
  return finding.usage ? VULNERABLE_API_LABEL[finding.usage.vulnerableApi] : '-';
}

const TABLE_HEADER = ['ID', 'Severity', 'CVSS', 'Dependency', 'Used', 'Vuln API', 'Fixed'] as const;
const COLUMN_GAP = '  ';

/** Pads every column but the last to its widest cell so long values never shift later columns. */
function renderColumns(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]?.length ?? 0))) ?? [];
  return rows.map((r) =>
    r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join(COLUMN_GAP),
  );
}

/** Just the sorted vulnerability table — no coverage note, no unresolved-dependency detail. */
export function renderVulnerabilityTable(report: ScanReport): string {
  if (report.findings.length === 0) return '';

  const findings = [...report.findings].sort(compareFindings);
  const rows = findings.map((finding) => {
    const cvss =
      finding.vulnerability.cvssScore !== undefined ? finding.vulnerability.cvssScore.toFixed(1) : '-';
    return [
      pickDisplayId(finding.vulnerability),
      finding.vulnerability.severity,
      cvss,
      `${finding.package.name}@${finding.package.version}`,
      usedLabel(finding),
      vulnerableApiLabel(finding),
      finding.fixedVersions.length > 0 ? finding.fixedVersions.join(', ') : 'no fix',
    ];
  });

  const [header = '', ...body] = renderColumns([TABLE_HEADER, ...rows]);
  const lines = [header];
  body.forEach((line, i) => {
    lines.push(line);
    const finding = findings[i];
    if (finding && finding.vulnerability.id !== rows[i]?.[0]) {
      lines.push(`  (${finding.vulnerability.id})`);
    }
  });
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

/** Phase 4 evidence: for every finding, where the application source uses the dependency. */
export function renderSourceUsage(report: ScanReport): string {
  const note = stageNote(report, 'SOURCE_USAGE');
  if (note || !report.sourceAnalysis) return `Source usage: unavailable (${note ?? 'not analyzed'})`;

  const { mainFiles, testFiles, skippedFiles } = report.sourceAnalysis;
  const skippedNote = skippedFiles.length > 0 ? `, ${skippedFiles.length} skipped` : '';
  const lines = [`Source usage: ${mainFiles + testFiles} Java files analyzed (${mainFiles} main, ${testFiles} test${skippedNote})`];

  for (const finding of [...report.findings].sort(compareFindings)) {
    const usage = finding.usage;
    if (!usage) continue;
    const verdict = !usage.used ? 'not used' : usage.viaApi ? 'used via API' : 'used';
    lines.push(
      '',
      `${pickDisplayId(finding.vulnerability)}  ${finding.package.name}@${finding.package.version}  ${verdict}, vulnerable API ${VULNERABLE_API_LABEL[usage.vulnerableApi]}`,
      `  packages: ${usage.packageMapping.packages.join(', ')} (${usage.packageMapping.basis === 'CURATED' ? 'curated mapping' : 'assumed from groupId'})`,
    );
    if (usage.viaApi) {
      lines.push(`  used through: ${usage.viaApi.path.join(' -> ')} (${usage.viaApi.reason})`);
    }
    if (usage.vulnerableApis.length > 0) {
      const apis = usage.vulnerableApis.map((api) => (api.method ? `${api.type}#${api.method}` : api.type));
      lines.push(`  vulnerable APIs checked: ${apis.join(', ')}`);
    }
    const usageRows = usage.usages.map((u) => {
      const { filePath, line } = u.evidence.location;
      const markers = [u.sourceSet === 'TEST' ? '[test]' : '', u.vulnerableApi ? '[vulnerable API]' : '']
        .filter((m) => m !== '')
        .join(' ');
      return [`${filePath}:${line}`, u.kind, `${u.symbol}${markers ? `  ${markers}` : ''}`];
    });
    lines.push(...renderColumns(usageRows).map((l) => `  ${l}`));
  }

  return lines.join('\n');
}

/** Phase 5 evidence: each HTTP entry point with the handler method and the annotations it came from. */
export function renderEndpoints(report: ScanReport): string {
  const note = stageNote(report, 'SPRING_ENDPOINT');
  if (note) return `Spring endpoints: unavailable (${note})`;

  const lines = [`Spring endpoints: ${report.endpoints.length}`];
  if (report.endpoints.length === 0) return lines[0] as string;

  const rows = report.endpoints.map((e) => [
    e.httpMethod,
    e.path,
    `${e.controllerClass}#${e.controllerMethod}`,
    `${e.location.filePath}:${e.location.line}`,
  ]);
  renderColumns(rows).forEach((line, i) => {
    lines.push(`  ${line}`);
    const unresolved = report.endpoints[i]?.unresolved ?? [];
    if (unresolved.length > 0) lines.push(`    unresolved: ${unresolved.join(', ')}`);
  });
  return lines.join('\n');
}
