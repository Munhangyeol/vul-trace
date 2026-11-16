import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, SpringEndpoint as SpringEndpointRow } from '@prisma/client';
import type { EndpointHttpMethod, SpringEndpoint, SpringEndpointEvidence } from '@vulntrace/shared';
import type { EndpointRepository } from '@vulntrace/core';

function toSpringEndpoint(row: SpringEndpointRow): SpringEndpoint {
  return {
    httpMethod: row.httpMethod as EndpointHttpMethod,
    path: row.path,
    controllerClass: row.controllerClass,
    controllerMethod: row.controllerMethod,
    location: {
      filePath: row.filePath,
      line: row.line,
      ...(row.column !== null ? { column: row.column } : {}),
    },
    unresolved: row.unresolved as unknown as string[],
    evidence: row.evidence as unknown as SpringEndpointEvidence,
  };
}

/** Phase 5 — rows in `spring_endpoints`, the entry points Phase 6 reachability starts from. */
export class PrismaEndpointRepository implements EndpointRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveEndpoints(scanId: string, endpoints: SpringEndpoint[]): Promise<void> {
    if (endpoints.length === 0) return;
    await this.prisma.springEndpoint.createMany({
      data: endpoints.map((e) => ({
        id: randomUUID(),
        scanId,
        httpMethod: e.httpMethod,
        path: e.path,
        controllerClass: e.controllerClass,
        controllerMethod: e.controllerMethod,
        filePath: e.location.filePath,
        line: e.location.line,
        column: e.location.column ?? null,
        unresolved: e.unresolved as unknown as Prisma.InputJsonValue,
        evidence: e.evidence as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  async listEndpoints(scanId: string): Promise<SpringEndpoint[]> {
    const rows = await this.prisma.springEndpoint.findMany({
      where: { scanId },
      orderBy: [{ path: 'asc' }, { httpMethod: 'asc' }, { filePath: 'asc' }, { line: 'asc' }],
    });
    return rows.map(toSpringEndpoint);
  }
}
