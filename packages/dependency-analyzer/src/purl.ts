import type { DependencyCoordinate, PackageCoordinate } from '@vulntrace/shared';

export interface MavenGav {
  groupId: string;
  artifactId: string;
  version: string;
}

const encode = (part: string): string => encodeURIComponent(part.trim());

/**
 * Builds a Maven package URL: `pkg:maven/{groupId}/{artifactId}@{version}`.
 * See https://github.com/package-url/purl-spec (maven type).
 */
export function toMavenPurl({ groupId, artifactId, version }: MavenGav): string {
  for (const [field, value] of Object.entries({ groupId, artifactId, version })) {
    if (value.trim() === '') {
      throw new TypeError(`Maven ${field} must not be empty`);
    }
  }
  return `pkg:maven/${encode(groupId)}/${encode(artifactId)}@${encode(version)}`;
}

export function toPackageCoordinate(dependency: DependencyCoordinate): PackageCoordinate {
  return {
    ecosystem: 'Maven',
    name: `${dependency.groupId}:${dependency.artifactId}`,
    version: dependency.version,
    purl: dependency.purl,
  };
}
