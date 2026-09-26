import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { DependencySource, ProjectDependency, VulnerabilityFinding } from '@vulntrace/shared';
import type { FindingRepository } from '@vulntrace/core';

function isDependencySourceKind(value: string): value is DependencySource['kind'] {
  return value === 'pom.xml' || value === 'dependency-tree';
}

/** Vulnerability findings are Phase 2 (CLAUDE.md §7); only dependency evidence is implemented here. */
export class PrismaFindingRepository implements FindingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveDependencies(scanId: string, dependencies: ProjectDependency[]): Promise<void> {
    for (const { coordinate, source } of dependencies) {
      const dependencyRow = await this.prisma.dependency.upsert({
        where: { purl: coordinate.purl },
        create: {
          id: randomUUID(),
          groupId: coordinate.groupId,
          artifactId: coordinate.artifactId,
          version: coordinate.version,
          purl: coordinate.purl,
        },
        update: {
          groupId: coordinate.groupId,
          artifactId: coordinate.artifactId,
          version: coordinate.version,
        },
      });

      await this.prisma.projectDependency.upsert({
        where: { scanId_dependencyId: { scanId, dependencyId: dependencyRow.id } },
        create: {
          id: randomUUID(),
          scanId,
          dependencyId: dependencyRow.id,
          scope: coordinate.scope,
          direct: coordinate.direct,
          source: source.kind,
          sourcePath: source.filePath,
          introducedBy: source.introducedBy ?? [],
        },
        update: {
          scope: coordinate.scope,
          direct: coordinate.direct,
          source: source.kind,
          sourcePath: source.filePath,
          introducedBy: source.introducedBy ?? [],
        },
      });
    }
  }

  async listDependencies(scanId: string): Promise<ProjectDependency[]> {
    const rows = await this.prisma.projectDependency.findMany({
      where: { scanId },
      include: { dependency: true },
    });

    return rows.map((row) => ({
      coordinate: {
        groupId: row.dependency.groupId,
        artifactId: row.dependency.artifactId,
        version: row.dependency.version,
        scope: row.scope,
        direct: row.direct,
        purl: row.dependency.purl,
      },
      source: {
        kind: isDependencySourceKind(row.source) ? row.source : 'pom.xml',
        filePath: row.sourcePath ?? '',
        introducedBy: row.introducedBy.length > 0 ? row.introducedBy : undefined,
      },
    }));
  }

  async saveFindings(_scanId: string, _findings: VulnerabilityFinding[]): Promise<void> {
    throw new Error('Vulnerability findings are not implemented until Phase 2');
  }

  async listFindings(_scanId: string): Promise<VulnerabilityFinding[]> {
    throw new Error('Vulnerability findings are not implemented until Phase 2');
  }
}
