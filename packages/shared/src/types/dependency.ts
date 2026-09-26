export type MavenScope = 'compile' | 'provided' | 'runtime' | 'test' | 'system' | 'import';

export interface DependencyCoordinate {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  direct: boolean;
  purl: string;
}

/** Where a dependency was discovered — evidence, not just the conclusion. */
export interface DependencySource {
  kind: 'pom.xml' | 'dependency-tree';
  filePath: string;
  /** Transitive-only: the purl chain that pulled this dependency in, nearest first. */
  introducedBy?: string[];
}

export interface ProjectDependency {
  coordinate: DependencyCoordinate;
  source: DependencySource;
}

export type UnresolvedReason =
  'VERSION_MANAGED_BY_PARENT' | 'UNRESOLVED_PROPERTY' | 'VERSION_RANGE';

/** A dependency whose version could not be determined from pom.xml alone — no purl possible. */
export interface UnresolvedDependency {
  groupId: string;
  artifactId: string;
  rawVersion?: string;
  scope: string;
  reason: UnresolvedReason;
  source: DependencySource;
}

/** Ecosystem-level package identity used to query vulnerability providers. */
export interface PackageCoordinate {
  ecosystem: 'Maven';
  /** Maven: `groupId:artifactId` */
  name: string;
  version: string;
  purl: string;
}
