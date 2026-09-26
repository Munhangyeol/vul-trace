import type { Project } from '@vulntrace/shared';

export interface ProjectDto {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export function toProjectDto(project: Project): ProjectDto {
  return { id: project.id, name: project.name, path: project.path, createdAt: project.createdAt };
}
