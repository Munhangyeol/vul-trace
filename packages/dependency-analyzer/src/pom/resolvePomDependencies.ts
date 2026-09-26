import type { UnresolvedDependency, UnresolvedReason } from '@vulntrace/shared';
import type { DependencyCoordinate, DependencySource } from '@vulntrace/shared';
import { toMavenPurl } from '../purl.js';
import type { RawPom, RawPomDependency } from './PomModel.js';

export interface PomDependencyResolution {
  resolved: DependencyCoordinate[];
  unresolved: UnresolvedDependency[];
}

const MAX_PROPERTY_SUBSTITUTION_DEPTH = 10;
const PROPERTY_PATTERN = /\$\{([^}]+)\}/g;

function builtinProperty(name: string, pom: RawPom): string | undefined {
  switch (name) {
    case 'project.groupId':
      return pom.groupId ?? pom.parent?.groupId;
    case 'project.version':
      return pom.version ?? pom.parent?.version;
    case 'project.artifactId':
      return pom.artifactId;
    case 'project.parent.groupId':
      return pom.parent?.groupId;
    case 'project.parent.version':
      return pom.parent?.version;
    case 'project.parent.artifactId':
      return pom.parent?.artifactId;
    default:
      return undefined;
  }
}

/** Substitutes `${...}` placeholders, bounded to avoid unbounded/circular expansion. */
function substituteProperties(raw: string, pom: RawPom): string | undefined {
  let value = raw;
  for (let depth = 0; depth < MAX_PROPERTY_SUBSTITUTION_DEPTH; depth += 1) {
    if (!PROPERTY_PATTERN.test(value)) return value;
    PROPERTY_PATTERN.lastIndex = 0;

    let unresolved = false;
    const next = value.replace(PROPERTY_PATTERN, (match, name: string) => {
      const replacement = pom.properties[name] ?? builtinProperty(name, pom);
      if (replacement === undefined) {
        unresolved = true;
        return match;
      }
      return replacement;
    });

    if (unresolved) return undefined;
    if (next === value) return undefined; // circular reference: no progress made
    value = next;
  }
  return undefined; // exceeded max depth: likely circular
}

function findManagedVersion(dependency: RawPomDependency, pom: RawPom): string | undefined {
  const managed = pom.dependencyManagement.find(
    (d) =>
      d.groupId === dependency.groupId &&
      d.artifactId === dependency.artifactId &&
      d.classifier === dependency.classifier,
  );
  return managed?.version;
}

function isVersionRange(version: string): boolean {
  return version.startsWith('[') || version.startsWith('(');
}

function classifyUnresolvedReason(rawVersion: string | undefined, pom: RawPom): UnresolvedReason {
  if (rawVersion === undefined) {
    return pom.parent ? 'VERSION_MANAGED_BY_PARENT' : 'UNRESOLVED_PROPERTY';
  }
  return 'UNRESOLVED_PROPERTY';
}

/** Resolves each dependency's version via substitution + local dependencyManagement (CLAUDE.md §14). */
export function resolvePomDependencies(
  pom: RawPom,
  source: DependencySource,
): PomDependencyResolution {
  const resolved: DependencyCoordinate[] = [];
  const unresolved: UnresolvedDependency[] = [];

  for (const dependency of pom.dependencies) {
    const rawVersion = dependency.version ?? findManagedVersion(dependency, pom);

    if (rawVersion !== undefined && isVersionRange(rawVersion)) {
      unresolved.push({
        groupId: dependency.groupId,
        artifactId: dependency.artifactId,
        rawVersion: dependency.version,
        scope: dependency.scope,
        reason: 'VERSION_RANGE',
        source,
      });
      continue;
    }

    const resolvedVersion =
      rawVersion !== undefined ? substituteProperties(rawVersion, pom) : undefined;

    if (resolvedVersion === undefined) {
      unresolved.push({
        groupId: dependency.groupId,
        artifactId: dependency.artifactId,
        rawVersion: dependency.version,
        scope: dependency.scope,
        reason: classifyUnresolvedReason(dependency.version, pom),
        source,
      });
      continue;
    }

    resolved.push({
      groupId: dependency.groupId,
      artifactId: dependency.artifactId,
      version: resolvedVersion,
      scope: dependency.scope,
      direct: true,
      purl: toMavenPurl({
        groupId: dependency.groupId,
        artifactId: dependency.artifactId,
        version: resolvedVersion,
      }),
    });
  }

  return { resolved, unresolved };
}
