import { basename } from 'node:path';
import { compareFindings, pickDisplayId, planRemediation, summarizeScan } from '@vulntrace/core';
import type { ScanReport } from '@vulntrace/core';
import type {
  DependencyRemediation,
  FindingUsage,
  ReachabilityStatus,
  ScanStage,
  SourceLocation,
  VulnerabilityFinding,
} from '@vulntrace/shared';

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
      `${'Reachable:'.padEnd(SUMMARY_LABEL_WIDTH)}${
        summary.reachableVulnerabilities ?? `unavailable (${stageNote(report, 'REACHABILITY') ?? 'not analyzed'})`
      }`,
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

const REACHABILITY_LABEL: Record<ReachabilityStatus, string> = {
  REACHABLE: 'yes',
  NOT_REACHABLE: 'no path',
  NO_VULNERABLE_API_USAGE: 'no',
  NO_API_INFO: 'no info',
};

function reachableLabel(finding: VulnerabilityFinding): string {
  return finding.reachability ? REACHABILITY_LABEL[finding.reachability.status] : '-';
}

const TABLE_HEADER = ['ID', 'Risk', 'Severity', 'CVSS', 'Dependency', 'Used', 'Vuln API', 'Reachable', 'Fixed'] as const;
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
      finding.risk ? String(finding.risk.score) : '-',
      finding.vulnerability.severity,
      cvss,
      `${finding.package.name}@${finding.package.version}`,
      usedLabel(finding),
      vulnerableApiLabel(finding),
      reachableLabel(finding),
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

const at = (location: SourceLocation): string => `${location.filePath}:${location.line}`;

/** Phase 6 evidence: for every finding with vulnerable API usage, the call paths from endpoints. */
export function renderReachability(report: ScanReport): string {
  const note = stageNote(report, 'REACHABILITY');
  if (note) return `Reachability: unavailable (${note})`;
  const lines = [
    report.callGraph
      ? `Reachability: call graph of ${report.callGraph.methodCount} methods, ${report.callGraph.edgeCount} calls, ${report.callGraph.unresolvedCallCount} unresolved`
      : 'Reachability:',
  ];

  for (const finding of [...report.findings].sort(compareFindings)) {
    const reachability = finding.reachability;
    if (!reachability || reachability.status === 'NO_VULNERABLE_API_USAGE' || reachability.status === 'NO_API_INFO') {
      continue;
    }
    const header = `${pickDisplayId(finding.vulnerability)}  ${finding.package.name}@${finding.package.version}`;
    if (!reachability.reachable) {
      const { visitedMethodCount, unresolvedCallCount } = reachability.scope;
      lines.push(
        '',
        `${header}  not reachable (${reachability.reason ?? 'no path found'})`,
        `  searched ${visitedMethodCount} methods from ${reachability.scope.endpointCount} endpoints; ${unresolvedCallCount} calls could not be resolved — not proof of absence`,
      );
      continue;
    }
    const shown = reachability.truncated ? ` (showing ${reachability.paths.length})` : '';
    lines.push('', `${header}  reachable, ${reachability.totalPaths} path(s)${shown}`);
    for (const path of reachability.paths) {
      lines.push(`  ${path.endpoint.httpMethod} ${path.endpoint.path}`);
      for (const step of path.steps) {
        const basis = step.basis && step.basis !== 'DIRECT' ? `  [${step.basis.toLowerCase().replace(/_/g, ' ')}]` : '';
        lines.push(`    -> ${step.method.className}#${step.method.methodName}${basis}`);
        if (step.callSite) lines.push(`         ${at(step.callSite)}  ${step.callSnippet ?? ''}`.trimEnd());
      }
      const attribution = path.sinkAttribution === 'INITIALIZER' ? '  (in a field initializer)' : '';
      lines.push(`    => ${path.usage.symbol}${attribution}`);
    }
  }
  return lines.join('\n');
}

const signed = (weight: number): string => (weight > 0 ? `+${weight}` : String(weight));

/** Phase 7 evidence: every finding's score broken down into the reasons that add up to it. */
export function renderRisk(report: ScanReport): string {
  const note = stageNote(report, 'RISK');
  if (note) return `Risk: unavailable (${note})`;
  const scored = [...report.findings].sort(compareFindings).filter((f) => f.risk);
  if (scored.length === 0) return 'Risk: no findings';

  const lines = [`Risk: ${scored.length} findings scored (rules ${scored[0]?.risk?.rulesVersion ?? '-'}), highest first`];
  for (const finding of scored) {
    const risk = finding.risk;
    if (!risk) continue;
    lines.push('', `${pickDisplayId(finding.vulnerability)}  ${finding.package.name}@${finding.package.version}  risk ${risk.score}`);
    for (const reason of risk.reasons) {
      const weight = reason.status === 'NOT_ANALYZED' ? '?' : signed(reason.weight);
      const evidence = reason.evidence?.length ? `  [${reason.evidence.join('; ')}]` : '';
      lines.push(`  ${weight.padStart(4)}  ${reason.description}${evidence}`);
    }
  }
  return lines.join('\n');
}

const FIX_STATUS_LABEL: Record<DependencyRemediation['findings'][number]['status'], string> = {
  FIXED: 'fixed',
  STILL_AFFECTED: 'still affected',
  NO_FIX: 'no fix published',
  UNKNOWN: 'cannot evaluate',
};

/** Phase 8: one upgrade decision per vulnerable dependency, highest risk first. */
export function renderFixPlan(report: ScanReport): string {
  const note = stageNote(report, 'VULNERABILITY');
  if (note && report.findings.length === 0) return `Fix plan: unavailable (${note})`;
  const plan = planRemediation({ findings: report.findings.map((finding) => ({ finding })), dependencies: report.dependencies });
  if (plan.length === 0) return 'Fix plan: no vulnerable dependencies';

  const lines = [
    `Fix plan: ${plan.length} ${plan.length === 1 ? 'dependency' : 'dependencies'}, ${report.findings.length} ${report.findings.length === 1 ? 'finding' : 'findings'}`,
  ];
  plan.forEach((item, index) => {
    const { dependency } = item;
    const target = item.recommendedVersion ? ` → ${item.recommendedVersion}` : '  (no fixed version)';
    const where =
      dependency.direct === undefined ? '' : dependency.direct ? `  (direct, ${dependency.declaredIn ?? 'pom.xml'})` : '  (transitive)';
    const facts = [
      `fixes ${item.fixedCount} of ${item.findings.length}`,
      item.maxRiskScore !== undefined ? `highest risk ${item.maxRiskScore}` : undefined,
      item.majorUpgrade ? 'MAJOR upgrade' : undefined,
    ].filter((f): f is string => f !== undefined);
    lines.push('', `${index + 1}. ${dependency.name}  ${dependency.currentVersion}${target}${where}`, `   ${facts.join('  ·  ')}`);
    for (const action of item.actions) lines.push(`   ${action.kind}: ${action.description}`);
    if (item.reachableEndpoints.length > 0) lines.push(`   reachable from: ${item.reachableEndpoints.join(', ')}`);
    if (item.affectedMethods.length > 0) lines.push(`   affected methods: ${item.affectedMethods.join(', ')}`);
    if (item.affectedFiles.length > 0) lines.push(`   affected files: ${item.affectedFiles.join(', ')}`);
    for (const f of item.findings) {
      const id = pickDisplayId({ id: f.vulnerabilityId, aliases: f.aliases } as Parameters<typeof pickDisplayId>[0]);
      const risk = f.riskScore !== undefined ? `risk ${f.riskScore}` : 'risk -';
      const fixes = f.fixedVersions.length > 0 ? `fixed in ${f.fixedVersions.join(', ')}` : 'no fixed version';
      lines.push(`     ${id}  ${risk}  ${FIX_STATUS_LABEL[f.status]}  (${fixes})`);
    }
  });
  lines.push('', `Basis: ${plan[0]?.basis ?? ''}`);
  return lines.join('\n');
}
