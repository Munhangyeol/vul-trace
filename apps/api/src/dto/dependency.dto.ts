import type { ProjectDependency } from '@vulntrace/shared';

export interface ProjectDependencyDto {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  direct: boolean;
  purl: string;
  source: {
    kind: 'pom.xml' | 'dependency-tree';
    filePath: string;
    introducedBy?: string[];
  };
}

export function toProjectDependencyDto(dependency: ProjectDependency): ProjectDependencyDto {
  const { coordinate, source } = dependency;
  return {
    groupId: coordinate.groupId,
    artifactId: coordinate.artifactId,
    version: coordinate.version,
    scope: coordinate.scope,
    direct: coordinate.direct,
    purl: coordinate.purl,
    source: {
      kind: source.kind,
      filePath: source.filePath,
      introducedBy: source.introducedBy,
    },
  };
}
