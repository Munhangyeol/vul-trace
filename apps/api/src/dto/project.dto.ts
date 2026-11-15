import type { Project, ProjectDto } from '@vulntrace/shared';

export type { ProjectDto };

export function toProjectDto(project: Project): ProjectDto {
  const { source } = project;
  const sourceFields =
    source.type === 'GIT'
      ? {
          sourceType: source.type,
          repoUrl: source.repoUrl,
          ...(source.ref ? { ref: source.ref } : {}),
        }
      : { sourceType: source.type, path: source.path };
  return { id: project.id, name: project.name, ...sourceFields, createdAt: project.createdAt };
}
