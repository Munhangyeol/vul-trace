import { existsSync, statSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { compareFindings, summarizeScan } from '@vulntrace/core';
import type { ProjectListItemDto, ProjectSummaryDto, ScanJob } from '@vulntrace/shared';
import type { Container } from '../container.js';
import { toProjectDependencyDto } from '../dto/dependency.dto.js';
import { toProjectDto } from '../dto/project.dto.js';
import { toVulnerabilityFindingDto } from '../dto/vulnerability.dto.js';
import { isWithinScanRoot } from '../lib/scanRoot.js';

/**
 * Loads the latest scan for a project with its summary numbers (CLAUDE.md §7 Phase 3 D4/D5).
 * N+1 against the DB per project — acceptable at MVP scale (see phase-3 plan §3 risks).
 */
async function loadLatestScanSummary(
  container: Container,
  projectId: string,
): Promise<{ scan: ScanJob; summary: ReturnType<typeof summarizeScan> } | null> {
  const scans = await container.scanRepository.listByProject(projectId);
  const scan = scans[0];
  if (!scan) return null;

  const [dependencies, findings] = await Promise.all([
    container.findingRepository.listDependencies(scan.id),
    container.findingRepository.listFindings(scan.id),
  ]);

  const summary = summarizeScan({
    dependencies,
    unresolvedDependencies: scan.unresolvedDependencies,
    findings: findings.map((f) => f.finding),
    vulnerabilityCoverage: scan.vulnerabilityCoverage,
  });

  return { scan, summary };
}

interface CreateProjectBody {
  name: string;
  path: string;
}

const createProjectSchema = {
  body: {
    type: 'object',
    required: ['name', 'path'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      path: { type: 'string', minLength: 1 },
    },
  },
};

export function createProjectRoutes(container: Container): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: CreateProjectBody }>(
      '/projects',
      { schema: createProjectSchema },
      async (request, reply) => {
        const { name, path } = request.body;

        if (!isWithinScanRoot(path, container.scanRoot)) {
          return reply
            .code(400)
            .send({ error: 'PATH_NOT_ALLOWED', message: `path is outside the allowed scan root` });
        }
        if (!existsSync(path) || !statSync(path).isDirectory()) {
          return reply
            .code(400)
            .send({
              error: 'PATH_NOT_FOUND',
              message: `path does not exist or is not a directory: ${path}`,
            });
        }

        const project = await container.projectRepository.create({ name, path });
        return reply.code(201).send(toProjectDto(project));
      },
    );

    app.get('/projects', async () => {
      const projects = await container.projectRepository.list();
      const items: ProjectListItemDto[] = await Promise.all(
        projects.map(async (project) => {
          const dto = toProjectDto(project);
          const loaded = await loadLatestScanSummary(container, project.id);
          if (!loaded) return dto;
          return {
            ...dto,
            latestScan: {
              id: loaded.scan.id,
              state: loaded.scan.state,
              finishedAt: loaded.scan.finishedAt,
              dependencyCount: loaded.summary.dependencies,
              vulnerabilityCount: loaded.summary.vulnerabilities,
              bySeverity: loaded.summary.bySeverity,
            },
          };
        }),
      );
      return items;
    });

    app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (request, reply) => {
      const project = await container.projectRepository.findById(request.params.projectId);
      if (!project) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
      }
      return toProjectDto(project);
    });

    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/summary',
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const loaded = await loadLatestScanSummary(container, project.id);
        const dto: ProjectSummaryDto = {
          project: toProjectDto(project),
          latestScan: loaded
            ? {
                scanId: loaded.scan.id,
                state: loaded.scan.state,
                startedAt: loaded.scan.startedAt,
                finishedAt: loaded.scan.finishedAt,
                stages: loaded.scan.stages,
                dependencies: loaded.summary.dependencies,
                vulnerabilities: loaded.summary.vulnerabilities,
                findings: loaded.summary.findings,
                bySeverity: loaded.summary.bySeverity,
                coverage: loaded.summary.coverage,
                unresolvedDependencies: loaded.scan.unresolvedDependencies,
              }
            : null,
        };
        return dto;
      },
    );

    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/dependencies',
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const scans = await container.scanRepository.listByProject(project.id);
        const latestScan = scans[0];
        if (!latestScan) return [];

        const dependencies = await container.findingRepository.listDependencies(latestScan.id);
        return dependencies.map(toProjectDependencyDto);
      },
    );

    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/vulnerabilities',
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const scans = await container.scanRepository.listByProject(project.id);
        const latestScan = scans[0];
        if (!latestScan) {
          return { findings: [], coverage: { checked: 0, notChecked: 0, failed: 0 } };
        }

        const findings = await container.findingRepository.listFindings(latestScan.id);
        const sorted = [...findings].sort((a, b) => compareFindings(a.finding, b.finding));
        return {
          findings: sorted.map(toVulnerabilityFindingDto),
          coverage: latestScan.vulnerabilityCoverage,
        };
      },
    );
  };
}
