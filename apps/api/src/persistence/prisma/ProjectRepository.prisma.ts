import type { Project as ProjectRow, PrismaClient } from '@prisma/client';
import type { Project, ProjectSource } from '@vulntrace/shared';
import type { ProjectRepository } from '@vulntrace/core';

function toSource(row: ProjectRow): ProjectSource {
  if (row.sourceType === 'GIT') {
    return { type: 'GIT', repoUrl: row.repoUrl ?? '', ...(row.ref ? { ref: row.ref } : {}) };
  }
  return { type: 'LOCAL', path: row.path ?? '' };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    source: toSource(row),
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { name: string; source: ProjectSource }): Promise<Project> {
    const { source } = input;
    const row = await this.prisma.project.create({
      data:
        source.type === 'GIT'
          ? {
              name: input.name,
              sourceType: 'GIT',
              repoUrl: source.repoUrl,
              ref: source.ref ?? null,
            }
          : { name: input.name, sourceType: 'LOCAL', path: source.path },
    });
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
