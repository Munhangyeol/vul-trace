import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { VulnerabilityFinding } from '@vulntrace/shared';
import { LightweightJavaSourceAnalyzer } from './JavaSourceAnalyzer.js';
import { classifySourceSet } from './scanner/JavaFileScanner.js';
import { assessFindingUsage } from './usage/assessFindingUsage.js';
import { matchDependencyUsages } from './usage/UsageMatcher.js';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const COMMONS_TEXT = {
  groupId: 'org.apache.commons',
  artifactId: 'commons-text',
  purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
};

const text4shell: VulnerabilityFinding = {
  vulnerability: {
    id: 'GHSA-599f-7c49-w659',
    aliases: ['CVE-2022-42889'],
    summary: 'Arbitrary code execution in Apache Commons Text',
    severity: 'CRITICAL',
    severitySource: 'CVSS_V3',
    modified: '2024-02-16T08:09:06.872Z',
    references: [],
  },
  package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl: COMMONS_TEXT.purl },
  fixedVersions: ['1.10.0'],
  evidence: { provider: 'OSV', queriedAt: '2026-10-04T00:00:00Z', affectedRanges: [], affectedVersions: [] },
};

async function assessFixture(name: string) {
  const analysis = await new LightweightJavaSourceAnalyzer().analyzeProject(fixturePath(name));
  if (!analysis.ok) throw analysis.error;
  const [usage] = matchDependencyUsages(analysis.value, [COMMONS_TEXT]);
  return assessFindingUsage(text4shell, usage!);
}

describe('fixture expectations (CLAUDE.md §17)', () => {
  it('Case A — spring-vulnerable-unused: used=false', async () => {
    const result = await assessFixture('spring-vulnerable-unused');
    expect(result.used).toBe(false);
    expect(result.usages).toEqual([]);
  });

  it('Case B — spring-vulnerable-used: used=true with TemplateService.java:14 evidence', async () => {
    const result = await assessFixture('spring-vulnerable-used');
    expect(result.used).toBe(true);
    expect(result.vulnerableApi).toBe('USED');
    expect(result.usages.find((u) => u.vulnerableApi)).toMatchObject({
      kind: 'METHOD_CALL',
      symbol: 'org.apache.commons.text.StringSubstitutor#createInterpolator',
      evidence: {
        location: { filePath: 'src/main/java/com/example/demo/TemplateService.java', line: 14 },
        snippet: 'StringSubstitutor interpolator = StringSubstitutor.createInterpolator();',
      },
    });
  });

  it('Case C — spring-vulnerable-reachable: used=true', async () => {
    const result = await assessFixture('spring-vulnerable-reachable');
    expect(result.used).toBe(true);
    expect(result.vulnerableApi).toBe('USED');
  });
});

describe('LightweightJavaSourceAnalyzer', () => {
  const root = mkdtempSync(join(tmpdir(), 'vulntrace-java-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (relativePath: string, content: string): void => {
    mkdirSync(join(root, relativePath, '..'), { recursive: true });
    writeFileSync(join(root, relativePath), content);
  };

  it('analyzes main and test sources (multi-module), skipping target/, hidden dirs and oversized files', async () => {
    write('src/main/java/demo/A.java', 'package demo;\nclass A {}');
    write('module-b/src/main/java/b/B.java', 'package b;\nclass B {}');
    write('src/test/java/demo/ATest.java', 'package demo;\nclass ATest {}');
    write('target/generated-sources/src/main/java/G.java', 'class G {}');
    write('.git/src/main/java/H.java', 'class H {}');
    write('scripts/Tool.java', 'class Tool {}');
    write('src/main/java/demo/Huge.java', `package demo;\nclass Huge {}\n${'//'.padEnd(200, 'x')}`);

    const result = await new LightweightJavaSourceAnalyzer({ maxFileBytes: 100 }).analyzeProject(root);
    if (!result.ok) throw result.error;

    expect(result.value.files.map((f) => [f.filePath, f.sourceSet])).toEqual([
      ['module-b/src/main/java/b/B.java', 'MAIN'],
      ['src/main/java/demo/A.java', 'MAIN'],
      ['src/test/java/demo/ATest.java', 'TEST'],
    ]);
    expect(result.value.skippedFiles).toEqual([
      { filePath: 'src/main/java/demo/Huge.java', reason: expect.stringContaining('larger than 100 bytes') },
    ]);
    expect(result.value.warnings).toContainEqual(expect.stringContaining('Huge.java'));
  });

  it('warns when no Java sources exist', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'vulntrace-empty-'));
    try {
      const result = await new LightweightJavaSourceAnalyzer().analyzeProject(empty);
      expect(result.ok && result.value.warnings).toEqual([
        'no Java source files found under src/main/java or src/test/java',
      ]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('returns PROJECT_NOT_FOUND for a missing directory', async () => {
    const result = await new LightweightJavaSourceAnalyzer().analyzeProject(join(root, 'missing'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('classifySourceSet', () => {
  it('classifies Maven source roots and ignores everything else', () => {
    expect(classifySourceSet('src/main/java/a/A.java')).toBe('MAIN');
    expect(classifySourceSet('core/src/test/java/a/ATest.java')).toBe('TEST');
    expect(classifySourceSet('src/main/resources/A.java')).toBeUndefined();
  });
});
