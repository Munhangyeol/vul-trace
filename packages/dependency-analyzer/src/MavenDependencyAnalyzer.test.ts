import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, ProcessRunOptions } from './process/ProcessRunner.js';
import { MavenDependencyAnalyzer } from './MavenDependencyAnalyzer.js';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

class StubProcessRunner implements ProcessRunner {
  constructor(private readonly handler: (options: ProcessRunOptions) => ProcessResult) {}

  async run(
    _command: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessResult> {
    const result = this.handler(options);
    const outputArg = args.find((a) => a.startsWith('-DoutputFile='));
    if (result.exitCode === 0 && outputArg) {
      writeFileSync(outputArg.slice('-DoutputFile='.length), TREE_TEXT);
    }
    return result;
  }
}

const TREE_TEXT = [
  'com.example:spring-vulnerable-used:jar:0.0.1-SNAPSHOT',
  '+- org.springframework.boot:spring-boot-starter-web:jar:3.5.6:compile',
  '|  \\- org.springframework:spring-webmvc:jar:6.2.11:compile',
  '\\- org.apache.commons:commons-text:jar:1.9:compile',
].join('\n');

// The fixture pom.xml resolves these without Maven: commons-text (literal version),
// guava (property substitution) and jackson-databind (local dependencyManagement).
// spring-boot-starter-web stays unresolved (parent-managed) and commons-io stays
// unresolved (version range) until a real dependency:tree run supplies a version.

describe('MavenDependencyAnalyzer', () => {
  it('fails with PROJECT_NOT_FOUND for a missing path', async () => {
    const result = await new MavenDependencyAnalyzer().analyze(fixturePath('does-not-exist'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('resolves only direct dependencies when allowMaven is false, leaving parent-managed ones unresolved', async () => {
    const result = await new MavenDependencyAnalyzer().analyze(
      fixturePath('spring-vulnerable-used'),
      { allowMaven: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.transitive).toEqual({
      status: 'SKIPPED',
      reason: 'maven execution not allowed',
    });
    expect(result.value.dependencies).toHaveLength(3);
    const byArtifactId = new Map(
      result.value.dependencies.map((d) => [d.coordinate.artifactId, d.coordinate]),
    );
    expect(byArtifactId.get('commons-text')).toMatchObject({
      groupId: 'org.apache.commons',
      version: '1.9',
      direct: true,
    });
    expect(byArtifactId.get('guava')).toMatchObject({
      groupId: 'com.google.guava',
      version: '32.1.3-jre',
      direct: true,
    });
    expect(byArtifactId.get('jackson-databind')).toMatchObject({
      groupId: 'com.fasterxml.jackson.core',
      version: '2.15.2',
      direct: true,
    });

    expect(result.value.unresolvedDependencies).toHaveLength(2);
    const unresolvedByArtifactId = new Map(
      result.value.unresolvedDependencies.map((d) => [d.artifactId, d]),
    );
    expect(unresolvedByArtifactId.get('spring-boot-starter-web')).toMatchObject({
      reason: 'VERSION_MANAGED_BY_PARENT',
    });
    expect(unresolvedByArtifactId.get('commons-io')).toMatchObject({
      reason: 'VERSION_RANGE',
    });
  });

  it('includes transitive dependencies and resolves parent-managed versions when a tree run succeeds', async () => {
    const runner = new StubProcessRunner(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }));
    const result = await new MavenDependencyAnalyzer(runner).analyze(
      fixturePath('spring-vulnerable-used'),
      { allowMaven: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.transitive).toEqual({ status: 'RESOLVED' });
    // commons-io stays unresolved (version range) even after a real tree run,
    // since the stub tree output doesn't include it.
    expect(result.value.unresolvedDependencies).toHaveLength(1);
    expect(result.value.unresolvedDependencies[0]).toMatchObject({
      artifactId: 'commons-io',
      reason: 'VERSION_RANGE',
    });

    const artifactIds = result.value.dependencies.map((d) => d.coordinate.artifactId).sort();
    expect(artifactIds).toEqual([
      'commons-text',
      'guava',
      'jackson-databind',
      'spring-boot-starter-web',
      'spring-webmvc',
    ]);

    const webmvc = result.value.dependencies.find(
      (d) => d.coordinate.artifactId === 'spring-webmvc',
    );
    expect(webmvc?.coordinate.direct).toBe(false);
    expect(webmvc?.source.kind).toBe('dependency-tree');
  });

  it('keeps pom.xml results and marks the tree stage FAILED when mvn fails', async () => {
    const runner = new StubProcessRunner(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'BUILD FAILURE',
      timedOut: false,
    }));
    const result = await new MavenDependencyAnalyzer(runner).analyze(
      fixturePath('spring-vulnerable-used'),
      { allowMaven: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.transitive.status).toBe('FAILED');
    expect(result.value.transitive.reason).toContain('BUILD FAILURE');
    // pom-only result is preserved despite the tree failure.
    const artifactIds = result.value.dependencies.map((d) => d.coordinate.artifactId).sort();
    expect(artifactIds).toEqual(['commons-text', 'guava', 'jackson-databind']);
  });
});
