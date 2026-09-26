import type { Project } from '@vulntrace/shared';

export interface ProjectRepository {
  create(input: { name: string; path: string }): Promise<Project>;
  findById(projectId: string): Promise<Project | null>;
  list(): Promise<Project[]>;
}
