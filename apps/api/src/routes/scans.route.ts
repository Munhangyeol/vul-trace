import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ScanJob, ScanStageResult } from '@vulntrace/shared';
import type { Container } from '../container.js';
import { toScanJobDto } from '../dto/scan.dto.js';

interface CreateScanBody {
  allowMaven?: boolean;
  mavenTimeoutMs?: number;
  checkVulnerabilities?: boolean;
}

const createScanSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowMaven: { type: 'boolean' },
      mavenTimeoutMs: { type: 'integer', minimum: 1 },
      checkVulnerabilities: { type: 'boolean' },
    },
  },
};

function deriveFailureReason(stages: ScanStageResult[]): string | undefined {
  return stages.find((s) => s.status === 'FAILED')?.reason;
}

export function createScanRoutes(container: Container): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Params: { projectId: string }; Body: CreateScanBody }>(
      '/projects/:projectId/scans',
      { schema: createScanSchema },
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const report = await container.scanOrchestrator.run(project.path, {
          allowMaven: request.body.allowMaven ?? false,
          mavenTimeoutMs: request.body.mavenTimeoutMs,
          checkVulnerabilities: request.body.checkVulnerabilities ?? true,
        });

        const scanJob: ScanJob = {
          id: randomUUID(),
          projectId: project.id,
          state: report.state,
          startedAt: report.startedAt,
          finishedAt: report.finishedAt,
          failureReason: deriveFailureReason(report.stages),
          stages: report.stages,
          unresolvedDependencies: report.unresolvedDependencies,
          vulnerabilityCoverage: report.vulnerabilityCoverage,
        };

        await container.scanRepository.save(scanJob);
        await container.findingRepository.saveDependencies(scanJob.id, report.dependencies);
        await container.findingRepository.saveFindings(scanJob.id, report.findings);

        return reply.code(201).send(toScanJobDto(scanJob));
      },
    );

    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/scans',
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const scans = await container.scanRepository.listByProject(project.id);
        return scans.map(toScanJobDto);
      },
    );
  };
}
