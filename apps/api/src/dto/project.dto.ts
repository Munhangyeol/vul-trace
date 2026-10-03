import type { Project, ProjectDto } from '@vulntrace/shared';

export type { ProjectDto };

export function toProjectDto(project: Project): ProjectDto {
  return { id: project.id, name: project.name, path: project.path, createdAt: project.createdAt };
}
