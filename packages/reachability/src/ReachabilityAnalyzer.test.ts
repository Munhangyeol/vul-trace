import type { SourceUsage, SpringEndpoint, VulnerabilityFinding, VulnerableApiStatus } from '@vulntrace/shared';
import { LightweightJavaParser } from '@vulntrace/source-analyzer';
import type { JavaAnalysisResult } from '@vulntrace/source-analyzer';
import { describe, expect, it } from 'vitest';
import { CallGraphBuilder } from './CallGraphBuilder.js';
import { ReachabilityAnalyzer } from './ReachabilityAnalyzer.js';

const SINK = 'StringSubstitutor.createInterpolator()';

function project(sources: Record<string, string>): JavaAnalysisResult {
  const parser = new LightweightJavaParser();
  return {
    projectPath: '/p',
    files: Object.entries(sources).map(([filePath, source]) => ({
      ...parser.parse(filePath, source),
      sourceSet: filePath.includes('src/test/') ? ('TEST' as const) : ('MAIN' as const),
    })),
    skippedFiles: [],
    warnings: [],
  };
}

/** Vulnerable usages at every line containing `SINK`. */
function sinkUsages(java: JavaAnalysisResult): SourceUsage[] {
  return java.files.flatMap((file) =>
    file.lines.flatMap((text, i) => {
      const column = text.indexOf('createInterpolator');
      if (column < 0) return [];
      return [
        {
          kind: 'METHOD_CALL' as const,
          symbol: 'org.apache.commons.text.StringSubstitutor#createInterpolator',
          dependencyPurl: 'pkg:maven/org.apache.commons/commons-text@1.9',
          sourceSet: file.sourceSet,
          vulnerableApi: true,
          evidence: { location: { filePath: file.filePath, line: i + 1, column: column + 1 }, snippet: text.trim() },
        },
      ];
    }),
  );
}

function finding(usages: SourceUsage[], vulnerableApi: VulnerableApiStatus = 'USED'): VulnerabilityFinding {
  return {
    vulnerability: { id: 'GHSA-599f-7c49-w659', aliases: ['CVE-2022-42889'], severity: 'CRITICAL' },
    package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9' },
    fixedVersions: ['1.10.0'],
    evidence: { provider: 'OSV', queriedAt: '2026-11-22T00:00:00Z', affectedRanges: [], affectedVersions: [] },
    usage: {
      used: true,
      vulnerableApi,
      packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
      vulnerableApis: [{ type: 'org.apache.commons.text.StringSubstitutor', method: 'createInterpolator' }],
      usages,
    },
  } as unknown as VulnerabilityFinding;
}

function endpoint(controllerClass: string, controllerMethod: string, filePath: string, line: number, path = '/x'): SpringEndpoint {
  return {
    httpMethod: 'POST',
    path,
    controllerClass,
    controllerMethod,
    location: { filePath, line, column: 1 },
    unresolved: [],
    evidence: {
      controller: { annotation: '@RestController', location: { filePath, line: 1 } },
      methodMapping: { annotation: '@PostMapping', location: { filePath, line: line - 1 } },
    },
  };
}

/** Line (1-based) of the first line of `source` containing `needle`. */
const lineOf = (source: string, needle: string): number => source.split('\n').findIndex((l) => l.includes(needle)) + 1;

const CONTROLLER = [
  'package com.example;',
  'import org.springframework.web.bind.annotation.*;',
  '@RestController',
  'public class C {',
  '  private final S service;',
  '  public C(S service) { this.service = service; }',
  '  @PostMapping("/x")',
  '  public String handle(String t) {',
  '    return service.render(t);',
  '  }',
  '}',
].join('\n');

const SERVICE = [
  'package com.example;',
  'import org.apache.commons.text.StringSubstitutor;',
  'public class S {',
  '  public String render(String t) {',
  '    return helper(t);',
  '  }',
  '  private String helper(String t) {',
  `    return ${SINK}.replace(t);`,
  '  }',
  '}',
].join('\n');

function analyze(sources: Record<string, string>, endpoints: SpringEndpoint[]) {
  const java = project(sources);
  return new ReachabilityAnalyzer().analyze({ java, endpoints, findings: [finding(sinkUsages(java))] });
}

const handler = endpoint('com.example.C', 'handle', 'C.java', lineOf(CONTROLLER, 'public String handle'));

describe('ReachabilityAnalyzer', () => {
  it('finds endpoint → field-injected service → private helper → vulnerable call, with call sites', () => {
    const { results } = analyze({ 'C.java': CONTROLLER, 'S.java': SERVICE }, [handler]);
    const result = results[0];
    expect(result?.status).toBe('REACHABLE');
    expect(result?.paths).toHaveLength(1);
    const steps = result?.paths[0]?.steps ?? [];
    expect(steps.map((s) => `${s.method.className}#${s.method.methodName}`)).toEqual([
      'com.example.C#handle',
      'com.example.S#render',
      'com.example.S#helper',
    ]);
    expect(steps.map((s) => [s.callSite?.filePath, s.callSite?.line, s.basis])).toEqual([
      ['C.java', 9, undefined],
      ['S.java', 5, 'DIRECT'],
      ['S.java', 8, 'DIRECT'],
    ]);
    expect(steps[0]?.callSnippet).toBe('return service.render(t);');
    expect(result?.paths[0]?.sinkAttribution).toBe('METHOD');
  });

  it('is NOT_REACHABLE when no endpoint calls the service, and says what it could not see', () => {
    const lonely = CONTROLLER.replace('return service.render(t);', 'return t;');
    const { results } = analyze({ 'C.java': lonely, 'S.java': SERVICE }, [handler]);
    expect(results[0]).toMatchObject({ status: 'NOT_REACHABLE', reachable: false, reason: 'no call path from any endpoint' });
    expect(results[0]?.scope).toMatchObject({ endpointCount: 1, visitedMethodCount: 1, unresolvedCallCount: 0 });
    expect(results[0]?.scope.unsupported.length).toBeGreaterThan(0);
  });

  it('reports no endpoints separately', () => {
    const { results } = analyze({ 'C.java': CONTROLLER, 'S.java': SERVICE }, []);
    expect(results[0]).toMatchObject({ status: 'NOT_REACHABLE', reason: 'no endpoints' });
  });

  it('maps Phase 4 statuses that need no search', () => {
    const java = project({ 'S.java': SERVICE });
    const analyzer = new ReachabilityAnalyzer();
    const { results } = analyzer.analyze({
      java,
      endpoints: [],
      findings: [finding([], 'NOT_DETECTED'), finding([], 'NO_API_INFO'), { ...finding([]), usage: undefined }],
    });
    expect(results.map((r) => r?.status)).toEqual(['NO_VULNERABLE_API_USAGE', 'NO_API_INFO', undefined]);
  });

  it('follows interface calls to every project implementation (CHA)', () => {
    const iface = 'package com.example;\npublic interface S {\n  String render(String t);\n}';
    const impl = SERVICE.replace('public class S {', 'public class SImpl implements S {');
    const other = 'package com.example;\npublic class Other implements S {\n  public String render(String t) { return t; }\n}';
    const { results } = analyze({ 'C.java': CONTROLLER, 'S.java': iface, 'SImpl.java': impl, 'O.java': other }, [handler]);
    const steps = results[0]?.paths[0]?.steps ?? [];
    expect(steps.map((s) => s.method.className)).toEqual(['com.example.C', 'com.example.SImpl', 'com.example.SImpl']);
    expect(steps[1]?.basis).toBe('INTERFACE_DISPATCH');
  });

  it('resolves locals, parameters, static calls, constructors and imports from another package', () => {
    const controller = [
      'package com.example.web;',
      'import com.example.core.Util;',
      'import com.example.core.Worker;',
      '@RestController',
      'public class C {',
      '  @PostMapping("/x")',
      '  public String handle(String t) {',
      '    Worker w = new Worker(t);',
      '    return Util.wrap(w);',
      '  }',
      '}',
    ].join('\n');
    const util = [
      'package com.example.core;',
      'public class Util {',
      '  public static String wrap(Worker w) { return w.run(); }',
      '}',
    ].join('\n');
    const worker = [
      'package com.example.core;',
      'public class Worker {',
      '  private final Object seed = ' + SINK + ';',
      '  public Worker(String t) {}',
      '  public String run() { return ""; }',
      '}',
    ].join('\n');
    const { results } = analyze(
      { 'web/C.java': controller, 'core/Util.java': util, 'core/Worker.java': worker },
      [endpoint('com.example.web.C', 'handle', 'web/C.java', 7)],
    );
    // The sink is in a field initializer → runs in Worker's constructor, created in the handler.
    expect(results[0]?.status).toBe('REACHABLE');
    expect(results[0]?.paths[0]?.sinkAttribution).toBe('INITIALIZER');
    expect(results[0]?.paths[0]?.steps.map((s) => s.method.methodName)).toEqual(['handle', 'Worker']);
  });

  it('counts calls it cannot resolve in visited methods', () => {
    const controller = CONTROLLER.replace(
      'return service.render(t);',
      'return helper(t).render(t) + repo.render(t) + lib().trim() + other.find(t);',
    );
    const { results } = analyze({ 'C.java': controller, 'S.java': SERVICE }, [handler]);
    expect(results[0]?.status).toBe('NOT_REACHABLE');
    // Counted: `helper` (not on C), `.render` (chained), `repo.render` (unknown receiver) — all names a
    // project method has. Not counted: `lib`, `.trim`, `other.find` — no project method could answer.
    expect(results[0]?.scope.unresolvedCallCount).toBe(3);
  });

  it('survives recursion and stops at the depth limit', () => {
    const recursive = SERVICE.replace('return helper(t);', 'return render(t) + helper(t);');
    const { results } = analyze({ 'C.java': CONTROLLER, 'S.java': recursive }, [handler]);
    expect(results[0]?.status).toBe('REACHABLE');

    const java = project({ 'C.java': CONTROLLER, 'S.java': SERVICE });
    const shallow = new ReachabilityAnalyzer({ maxDepth: 1 }).analyze({
      java,
      endpoints: [handler],
      findings: [finding(sinkUsages(java))],
    });
    expect(shallow.results[0]?.status).toBe('NOT_REACHABLE');
  });

  it('ignores test sources and warns about handlers it cannot find', () => {
    const { results, warnings } = analyze(
      { 'src/test/java/C.java': CONTROLLER, 'S.java': SERVICE },
      [endpoint('com.example.C', 'handle', 'src/test/java/C.java', 8)],
    );
    expect(results[0]?.status).toBe('NOT_REACHABLE');
    expect(warnings).toHaveLength(1);
  });
});

describe('CallGraphBuilder', () => {
  it('links overloads by argument count and marks ties as ambiguous', () => {
    const source = [
      'package p;',
      'public class A {',
      '  void a() { b(1); b(); c(1); }',
      '  void b() {}',
      '  void b(int x) {}',
      '  void c(int x) {}',
      '  void c(String s) {}',
      '}',
    ].join('\n');
    const graph = new CallGraphBuilder().build(project({ 'A.java': source }));
    const out = graph.edges.get('p.A#0') ?? [];
    expect(out.map((e) => [e.calleeId, e.basis])).toEqual([
      ['p.A#2', 'DIRECT'],
      ['p.A#1', 'DIRECT'],
      ['p.A#3', 'AMBIGUOUS_OVERLOAD'],
      ['p.A#4', 'AMBIGUOUS_OVERLOAD'],
    ]);
  });
});
