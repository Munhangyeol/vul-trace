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
}

export interface ProjectDependency {
  coordinate: DependencyCoordinate;
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
