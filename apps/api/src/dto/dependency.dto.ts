import type { ProjectDependency, ProjectDependencyDto } from '@vulntrace/shared';

export type { ProjectDependencyDto };

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
