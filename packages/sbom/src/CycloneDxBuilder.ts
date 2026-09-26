import { randomUUID } from 'node:crypto';
import type { AnalysisError, ProjectDependency, Result } from '@vulntrace/shared';
import { AnalysisError as AnalysisErrorClass, ok, err } from '@vulntrace/shared';
import { mapMavenScopeToCycloneDx } from './scopeMapping.js';
import type { CycloneDxBom, CycloneDxComponent, CycloneDxDependencyEdge } from './types.js';

export interface SbomProjectMetadata {
  groupId: string;
  artifactId: string;
  version: string;
}

export interface SbomBuildInput {
  project: SbomProjectMetadata;
  /** Resolved dependencies only — a dependency without a version has no purl (CLAUDE.md §14). */
  dependencies: ProjectDependency[];
  /** Injected for deterministic output in tests. */
  timestamp: string;
  serialNumber?: string;
}

export interface SbomBuildResult {
  bom: CycloneDxBom;
  warnings: string[];
}

export interface SbomBuilder {
  build(input: SbomBuildInput): Result<SbomBuildResult, AnalysisError>;
}

function toRootPurl(project: SbomProjectMetadata): string {
  return `pkg:maven/${project.groupId}/${project.artifactId}@${project.version}`;
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Deduplicates by purl (first occurrence wins), returning a warning per collision. */
function dedupeComponents(dependencies: ProjectDependency[]): {
  components: CycloneDxComponent[];
  warnings: string[];
} {
  const byPurl = new Map<string, CycloneDxComponent>();
  const warnings: string[] = [];

  for (const { coordinate } of dependencies) {
    if (byPurl.has(coordinate.purl)) {
      warnings.push(`duplicate purl in dependencies, keeping the first occurrence: ${coordinate.purl}`);
      continue;
    }
    byPurl.set(coordinate.purl, {
      type: 'library',
      purl: coordinate.purl,
      group: coordinate.groupId,
      name: coordinate.artifactId,
      version: coordinate.version,
      scope: mapMavenScopeToCycloneDx(coordinate.scope),
    });
  }

  return { components: [...byPurl.values()], warnings };
}

/** Builds the `dependencies[]` graph from each dependency's `introducedBy` chain (nearest parent first). */
function buildDependencyGraph(
  dependencies: ProjectDependency[],
  rootPurl: string,
): CycloneDxDependencyEdge[] {
  const dependsOn = new Map<string, Set<string>>();
  const ensure = (ref: string): Set<string> => {
    let children = dependsOn.get(ref);
    if (!children) {
      children = new Set();
      dependsOn.set(ref, children);
    }
    return children;
  };

  ensure(rootPurl);
  for (const { coordinate, source } of dependencies) {
    const parentPurl = source.introducedBy?.[0] ?? rootPurl;
    ensure(parentPurl).add(coordinate.purl);
    ensure(coordinate.purl);
  }

  return [...dependsOn.entries()].map(([ref, children]) => ({
    ref,
    dependsOn: children.size > 0 ? [...children] : undefined,
  }));
}

/** Phase 2: CycloneDX 1.5 SBOM generation from resolved dependencies (CLAUDE.md §7 Phase 2). */
export class CycloneDxBuilder implements SbomBuilder {
  build(input: SbomBuildInput): Result<SbomBuildResult, AnalysisError> {
    if (!isIsoTimestamp(input.timestamp)) {
      return err(
        new AnalysisErrorClass('PARSE_ERROR', `Invalid SBOM timestamp: ${input.timestamp}`),
      );
    }

    const rootPurl = toRootPurl(input.project);
    const { components, warnings } = dedupeComponents(input.dependencies);
    const dependencies = buildDependencyGraph(input.dependencies, rootPurl);

    const bom: CycloneDxBom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${input.serialNumber ?? randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: input.timestamp,
        tools: [{ vendor: 'VulnTrace', name: 'CycloneDxBuilder', version: '0.0.0' }],
        component: {
          type: 'application',
          name: input.project.artifactId,
          version: input.project.version,
        },
      },
      components,
      dependencies,
    };

    return ok({ bom, warnings });
  }
}
