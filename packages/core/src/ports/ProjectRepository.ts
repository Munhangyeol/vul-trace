import type { Project, ProjectSource } from '@vulntrace/shared';

export interface ProjectRepository {
  create(input: { name: string; source: ProjectSource }): Promise<Project>;
  findById(projectId: string): Promise<Project | null>;
  list(): Promise<Project[]>;
}
