import type { ScanJob as ScanJobRow, Prisma, PrismaClient } from '@prisma/client';
import type { ScanJob, ScanStageResult, UnresolvedDependency } from '@vulntrace/shared';
import type { ScanRepository } from '@vulntrace/core';

function toScanJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    projectId: row.projectId,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    failureReason: row.failureReason ?? undefined,
    stages: row.stageResults as unknown as ScanStageResult[],
    unresolvedDependencies: row.unresolvedDependencies as unknown as UnresolvedDependency[],
  };
}

export class PrismaScanRepository implements ScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(scan: ScanJob): Promise<void> {
    const data = {
      projectId: scan.projectId,
      state: scan.state,
      startedAt: new Date(scan.startedAt),
      finishedAt: scan.finishedAt ? new Date(scan.finishedAt) : null,
      failureReason: scan.failureReason ?? null,
      stageResults: scan.stages as unknown as Prisma.InputJsonValue,
      unresolvedDependencies: scan.unresolvedDependencies as unknown as Prisma.InputJsonValue,
    };

    await this.prisma.scanJob.upsert({
      where: { id: scan.id },
      create: { id: scan.id, ...data },
      update: data,
    });
  }

  async findById(scanId: string): Promise<ScanJob | null> {
    const row = await this.prisma.scanJob.findUnique({ where: { id: scanId } });
    return row ? toScanJob(row) : null;
  }

  async listByProject(projectId: string): Promise<ScanJob[]> {
    const rows = await this.prisma.scanJob.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(toScanJob);
  }
}
