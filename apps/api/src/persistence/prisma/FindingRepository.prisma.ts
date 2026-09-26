import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AffectedRange,
  DependencySource,
  ProjectDependency,
  Severity,
  SeveritySource,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import type { FindingRepository, StoredFinding } from '@vulntrace/core';

function isDependencySourceKind(value: string): value is DependencySource['kind'] {
  return value === 'pom.xml' || value === 'dependency-tree';
}

/** Vulnerability findings are Phase 2 (CLAUDE.md §7). */
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

  async saveFindings(scanId: string, findings: VulnerabilityFinding[]): Promise<void> {
    for (const finding of findings) {
      const { vulnerability, package: pkg, fixedVersions, evidence } = finding;

      const dependencyRow = await this.prisma.dependency.findUnique({ where: { purl: pkg.purl } });
      if (!dependencyRow) {
        throw new Error(
          `Cannot save finding ${vulnerability.id}: dependency ${pkg.purl} was not saved first (call saveDependencies before saveFindings)`,
        );
      }
      const projectDependencyRow = await this.prisma.projectDependency.findUnique({
        where: { scanId_dependencyId: { scanId, dependencyId: dependencyRow.id } },
      });
      if (!projectDependencyRow) {
        throw new Error(
          `Cannot save finding ${vulnerability.id}: no ProjectDependency for scan ${scanId} / ${pkg.purl}`,
        );
      }

      const vulnerabilityRow = await this.prisma.vulnerability.upsert({
        where: { sourceId: vulnerability.id },
        create: {
          id: randomUUID(),
          sourceId: vulnerability.id,
          aliases: vulnerability.aliases,
          summary: vulnerability.summary,
          details: vulnerability.details ?? null,
          severity: vulnerability.severity,
          severitySource: vulnerability.severitySource,
          cvssVector: vulnerability.cvssVector ?? null,
          cvssScore: vulnerability.cvssScore ?? null,
          publishedAt: vulnerability.published ? new Date(vulnerability.published) : null,
          modifiedAt: new Date(vulnerability.modified),
          references: vulnerability.references as unknown as Prisma.InputJsonValue,
        },
        update: {
          aliases: vulnerability.aliases,
          summary: vulnerability.summary,
          details: vulnerability.details ?? null,
          severity: vulnerability.severity,
          severitySource: vulnerability.severitySource,
          cvssVector: vulnerability.cvssVector ?? null,
          cvssScore: vulnerability.cvssScore ?? null,
          publishedAt: vulnerability.published ? new Date(vulnerability.published) : null,
          modifiedAt: new Date(vulnerability.modified),
          references: vulnerability.references as unknown as Prisma.InputJsonValue,
        },
      });

      await this.prisma.projectVulnerability.upsert({
        where: {
          projectDependencyId_vulnerabilityId: {
            projectDependencyId: projectDependencyRow.id,
            vulnerabilityId: vulnerabilityRow.id,
          },
        },
        create: {
          id: randomUUID(),
          scanId,
          projectDependencyId: projectDependencyRow.id,
          vulnerabilityId: vulnerabilityRow.id,
          fixedVersions,
          provider: evidence.provider,
          queriedAt: new Date(evidence.queriedAt),
          affectedRanges: evidence.affectedRanges as unknown as Prisma.InputJsonValue,
          affectedVersions: evidence.affectedVersions,
        },
        update: {
          fixedVersions,
          provider: evidence.provider,
          queriedAt: new Date(evidence.queriedAt),
          affectedRanges: evidence.affectedRanges as unknown as Prisma.InputJsonValue,
          affectedVersions: evidence.affectedVersions,
        },
      });
    }
  }

  async listFindings(scanId: string): Promise<StoredFinding[]> {
    const rows = await this.prisma.projectVulnerability.findMany({
      where: { scanId },
      include: { vulnerability: true, projectDependency: { include: { dependency: true } } },
    });
    return rows.map(toStoredFinding);
  }

  async findFindingById(findingId: string): Promise<StoredFinding | null> {
    const row = await this.prisma.projectVulnerability.findUnique({
      where: { id: findingId },
      include: { vulnerability: true, projectDependency: { include: { dependency: true } } },
    });
    return row ? toStoredFinding(row) : null;
  }
}

interface ProjectVulnerabilityRow {
  id: string;
  fixedVersions: string[];
  queriedAt: Date;
  affectedRanges: unknown;
  affectedVersions: string[];
  vulnerability: {
    sourceId: string;
    aliases: string[];
    summary: string;
    details: string | null;
    severity: string;
    severitySource: string;
    cvssVector: string | null;
    cvssScore: number | null;
    publishedAt: Date | null;
    modifiedAt: Date;
    references: unknown;
  };
  projectDependency: {
    dependency: { groupId: string; artifactId: string; version: string; purl: string };
  };
}

function toStoredFinding(row: ProjectVulnerabilityRow): StoredFinding {
  return {
    id: row.id,
    finding: {
      vulnerability: {
        id: row.vulnerability.sourceId,
        aliases: row.vulnerability.aliases,
        summary: row.vulnerability.summary,
        details: row.vulnerability.details ?? undefined,
        severity: row.vulnerability.severity as Severity,
        severitySource: row.vulnerability.severitySource as SeveritySource,
        cvssVector: row.vulnerability.cvssVector ?? undefined,
        cvssScore: row.vulnerability.cvssScore ?? undefined,
        published: row.vulnerability.publishedAt?.toISOString(),
        modified: row.vulnerability.modifiedAt.toISOString(),
        references: row.vulnerability.references as unknown as string[],
      },
      package: {
        ecosystem: 'Maven',
        name: `${row.projectDependency.dependency.groupId}:${row.projectDependency.dependency.artifactId}`,
        version: row.projectDependency.dependency.version,
        purl: row.projectDependency.dependency.purl,
      },
      fixedVersions: row.fixedVersions,
      evidence: {
        provider: 'OSV',
        queriedAt: row.queriedAt.toISOString(),
        affectedRanges: row.affectedRanges as unknown as AffectedRange[],
        affectedVersions: row.affectedVersions,
      },
    },
  };
}
