import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type {
  AffectedRange,
  DependencySource,
  FindingUsage,
  PackageMapping,
  ProjectDependency,
  Severity,
  SeveritySource,
  SourceSet,
  SourceUsage,
  UsageKind,
  ViaApiEvidence,
  VulnerabilityFinding,
  VulnerableApiRef,
  VulnerableApiStatus,
} from '@vulntrace/shared';
import type { FindingRepository, StoredFinding } from '@vulntrace/core';

function isDependencySourceKind(value: string): value is DependencySource['kind'] {
  return value === 'pom.xml' || value === 'dependency-tree';
}

/** Stored in `project_vulnerabilities.usage_analysis` — the basis for `used` / `vulnerable_api_status`. */
interface UsageAnalysisJson {
  packageMapping: PackageMapping;
  vulnerableApis: VulnerableApiRef[];
  /** Present when `used` comes from an implemented API (log4j-api → log4j-core). */
  viaApi?: ViaApiEvidence;
}

/** Phase 4 columns on project_vulnerabilities; all null when source usage was not analyzed. */
function usageColumns(usage: FindingUsage | undefined) {
  if (!usage) {
    return { used: null, vulnerableApiStatus: null, usageAnalysis: Prisma.DbNull };
  }
  const analysis: UsageAnalysisJson = {
    packageMapping: usage.packageMapping,
    vulnerableApis: usage.vulnerableApis,
    ...(usage.viaApi ? { viaApi: usage.viaApi } : {}),
  };
  return {
    used: usage.used,
    vulnerableApiStatus: usage.vulnerableApi,
    usageAnalysis: analysis as unknown as Prisma.InputJsonValue,
  };
}

const FINDING_INCLUDE = {
  vulnerability: true,
  projectDependency: { include: { dependency: true } },
  sourceUsages: { orderBy: [{ filePath: 'asc' }, { line: 'asc' }, { column: 'asc' }] },
} satisfies Prisma.ProjectVulnerabilityInclude;

/** Vulnerability findings are Phase 2 (CLAUDE.md §7); source usage evidence is Phase 4. */
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

      const projectVulnerabilityRow = await this.prisma.projectVulnerability.upsert({
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
          ...usageColumns(finding.usage),
        },
        update: {
          fixedVersions,
          provider: evidence.provider,
          queriedAt: new Date(evidence.queriedAt),
          affectedRanges: evidence.affectedRanges as unknown as Prisma.InputJsonValue,
          affectedVersions: evidence.affectedVersions,
          ...usageColumns(finding.usage),
        },
      });

      // Replace, not append, so re-saving a finding never duplicates its evidence rows.
      await this.prisma.sourceUsage.deleteMany({
        where: { projectVulnerabilityId: projectVulnerabilityRow.id },
      });
      if (finding.usage && finding.usage.usages.length > 0) {
        await this.prisma.sourceUsage.createMany({
          data: finding.usage.usages.map((usage) => ({
            id: randomUUID(),
            scanId,
            projectVulnerabilityId: projectVulnerabilityRow.id,
            filePath: usage.evidence.location.filePath,
            line: usage.evidence.location.line,
            column: usage.evidence.location.column ?? null,
            snippet: usage.evidence.snippet,
            usageKind: usage.kind,
            symbol: usage.symbol,
            sourceSet: usage.sourceSet,
            vulnerableApi: usage.vulnerableApi,
          })),
        });
      }
    }
  }

  async listFindings(scanId: string): Promise<StoredFinding[]> {
    const rows = await this.prisma.projectVulnerability.findMany({
      where: { scanId },
      include: FINDING_INCLUDE,
    });
    return rows.map(toStoredFinding);
  }

  async findFindingById(findingId: string): Promise<StoredFinding | null> {
    const row = await this.prisma.projectVulnerability.findUnique({
      where: { id: findingId },
      include: FINDING_INCLUDE,
    });
    return row ? toStoredFinding(row) : null;
  }
}

interface SourceUsageRow {
  filePath: string;
  line: number;
  column: number | null;
  snippet: string;
  usageKind: string;
  symbol: string;
  sourceSet: string;
  vulnerableApi: boolean;
}

interface ProjectVulnerabilityRow {
  id: string;
  fixedVersions: string[];
  queriedAt: Date;
  affectedRanges: unknown;
  affectedVersions: string[];
  used: boolean | null;
  vulnerableApiStatus: string | null;
  usageAnalysis: unknown;
  sourceUsages: SourceUsageRow[];
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

function toFindingUsage(row: ProjectVulnerabilityRow, purl: string): FindingUsage | undefined {
  if (row.used === null || row.vulnerableApiStatus === null || row.usageAnalysis === null) return undefined;
  const analysis = row.usageAnalysis as UsageAnalysisJson;
  return {
    used: row.used,
    ...(analysis.viaApi ? { viaApi: analysis.viaApi } : {}),
    vulnerableApi: row.vulnerableApiStatus as VulnerableApiStatus,
    packageMapping: analysis.packageMapping,
    vulnerableApis: analysis.vulnerableApis,
    usages: row.sourceUsages.map(
      (usage): SourceUsage => ({
        kind: usage.usageKind as UsageKind,
        symbol: usage.symbol,
        dependencyPurl: purl,
        sourceSet: usage.sourceSet as SourceSet,
        vulnerableApi: usage.vulnerableApi,
        evidence: {
          location: {
            filePath: usage.filePath,
            line: usage.line,
            ...(usage.column !== null ? { column: usage.column } : {}),
          },
          snippet: usage.snippet,
        },
      }),
    ),
  };
}

function toStoredFinding(row: ProjectVulnerabilityRow): StoredFinding {
  const usage = toFindingUsage(row, row.projectDependency.dependency.purl);
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
      ...(usage ? { usage } : {}),
    },
  };
}
