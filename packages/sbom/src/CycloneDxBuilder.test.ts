import { describe, expect, it } from 'vitest';
import type { ProjectDependency } from '@vulntrace/shared';
import { CycloneDxBuilder } from './CycloneDxBuilder.js';

const PROJECT = { groupId: 'com.example', artifactId: 'demo', version: '0.0.1-SNAPSHOT' };
const TIMESTAMP = '2026-09-26T00:00:00.000Z';
const SERIAL = '00000000-0000-4000-8000-000000000000';

function dep(
  overrides: Partial<ProjectDependency['coordinate']> & { introducedBy?: string[] } = {},
): ProjectDependency {
  const { introducedBy, ...coordinateOverrides } = overrides;
  return {
    coordinate: {
      groupId: 'org.apache.commons',
      artifactId: 'commons-text',
      version: '1.9',
      scope: 'compile',
      direct: true,
      purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      ...coordinateOverrides,
    },
    source: { kind: 'pom.xml', filePath: 'pom.xml', introducedBy },
  };
}

describe('CycloneDxBuilder', () => {
  it('produces the required top-level fields', () => {
    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [],
      timestamp: TIMESTAMP,
      serialNumber: SERIAL,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.bom).toMatchObject({
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${SERIAL}`,
      version: 1,
      metadata: {
        timestamp: TIMESTAMP,
        component: { type: 'application', name: 'demo', version: '0.0.1-SNAPSHOT' },
      },
    });
  });

  it('returns 0 components for an empty dependency list', () => {
    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [],
      timestamp: TIMESTAMP,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bom.components).toHaveLength(0);
  });

  it.each([
    ['compile', 'required'],
    ['runtime', 'required'],
    ['system', 'required'],
    ['provided', 'optional'],
    ['test', 'excluded'],
    ['unknown-scope', 'required'],
  ])('maps Maven scope %s to CycloneDX scope %s', (mavenScope, cycloneDxScope) => {
    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [dep({ scope: mavenScope })],
      timestamp: TIMESTAMP,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bom.components[0]?.scope).toBe(cycloneDxScope);
  });

  it('merges duplicate purls and warns, keeping the first occurrence', () => {
    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [dep({ scope: 'compile' }), dep({ scope: 'test' })],
      timestamp: TIMESTAMP,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bom.components).toHaveLength(1);
    expect(result.value.bom.components[0]?.scope).toBe('required');
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toContain('commons-text@1.9');
  });

  it('produces deterministic output for the same injected timestamp and serialNumber', () => {
    const input = { project: PROJECT, dependencies: [dep()], timestamp: TIMESTAMP, serialNumber: SERIAL };
    const first = new CycloneDxBuilder().build(input);
    const second = new CycloneDxBuilder().build(input);
    expect(first).toEqual(second);
  });

  it('rejects an invalid timestamp', () => {
    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [],
      timestamp: 'not-a-date',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('builds a dependsOn graph from introducedBy, defaulting to the project root', () => {
    const rootPurl = `pkg:maven/${PROJECT.groupId}/${PROJECT.artifactId}@${PROJECT.version}`;
    const direct = dep({
      artifactId: 'spring-boot-starter-web',
      purl: 'pkg:maven/org.springframework.boot/spring-boot-starter-web@3.5.6',
    });
    const transitive = dep({
      artifactId: 'spring-webmvc',
      direct: false,
      purl: 'pkg:maven/org.springframework/spring-webmvc@6.2.11',
      introducedBy: ['pkg:maven/org.springframework.boot/spring-boot-starter-web@3.5.6'],
    });

    const result = new CycloneDxBuilder().build({
      project: PROJECT,
      dependencies: [direct, transitive],
      timestamp: TIMESTAMP,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const edges = result.value.bom.dependencies;
    const rootEdge = edges.find((e) => e.ref === rootPurl);
    expect(rootEdge?.dependsOn).toEqual([direct.coordinate.purl]);

    const directEdge = edges.find((e) => e.ref === direct.coordinate.purl);
    expect(directEdge?.dependsOn).toEqual([transitive.coordinate.purl]);

    const transitiveEdge = edges.find((e) => e.ref === transitive.coordinate.purl);
    expect(transitiveEdge?.dependsOn).toBeUndefined();
  });
});
