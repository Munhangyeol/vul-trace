import type { Project as ProjectRow, PrismaClient } from '@prisma/client';
import type { Project } from '@vulntrace/shared';
import type { ProjectRepository } from '@vulntrace/core';

function toProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, path: row.path, createdAt: row.createdAt.toISOString() };
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { name: string; path: string }): Promise<Project> {
    const row = await this.prisma.project.create({ data: input });
    return toProject(row);
  }

  async findById(projectId: string): Promise<Project | null> {
    const row = await this.prisma.project.findUnique({ where: { id: projectId } });
    return row ? toProject(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toProject);
  }
}
