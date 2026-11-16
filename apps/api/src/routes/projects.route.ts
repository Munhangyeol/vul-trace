import { existsSync, statSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import {
  compareFindings,
  parseGitHubRepositoryUrl,
  summarizeScan,
  validateGitRef,
} from '@vulntrace/core';
import type {
  ProjectEndpointsDto,
  ProjectListItemDto,
  ProjectSource,
  ProjectSourceType,
  ProjectSummaryDto,
  ScanJob,
} from '@vulntrace/shared';
import type { Container } from '../container.js';
import { toProjectDependencyDto } from '../dto/dependency.dto.js';
import { toSpringEndpointDto } from '../dto/endpoint.dto.js';
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

/** "0 endpoints" is only a result when the stage ran; otherwise it is unknown. */
function springStageSucceeded(scan: ScanJob): boolean {
  return scan.stages.some((s) => s.stage === 'SPRING_ENDPOINT' && s.status === 'SUCCEEDED');
}

interface CreateProjectBody {
  name: string;
  /** Defaults to LOCAL so existing `{ name, path }` clients keep working. */
  sourceType?: ProjectSourceType;
  path?: string;
  repoUrl?: string;
  ref?: string;
}

const createProjectSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      sourceType: { type: 'string', enum: ['LOCAL', 'GIT'] },
      path: { type: 'string', minLength: 1 },
      repoUrl: { type: 'string', minLength: 1, maxLength: 300 },
      ref: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};

type SourceValidation =
  | { ok: true; source: ProjectSource }
  | { ok: false; error: string; message: string };

/**
 * GIT input is validated for shape only — no network access at registration; a missing
 * repository surfaces as a FAILED REPOSITORY_FETCH stage on the first scan.
 */
function validateProjectSource(body: CreateProjectBody, scanRoot: string | undefined): SourceValidation {
  const sourceType = body.sourceType ?? 'LOCAL';

  if (sourceType === 'GIT') {
    if (body.path !== undefined) {
      return { ok: false, error: 'INVALID_SOURCE', message: 'path is not allowed for a GIT project' };
    }
    if (!body.repoUrl) return { ok: false, error: 'INVALID_SOURCE', message: 'repoUrl is required' };
    const repository = parseGitHubRepositoryUrl(body.repoUrl);
    if (!repository.ok) {
      return { ok: false, error: repository.error.code, message: repository.error.message };
    }
    if (body.ref !== undefined) {
      const ref = validateGitRef(body.ref);
      if (!ref.ok) return { ok: false, error: ref.error.code, message: ref.error.message };
    }
    return {
      ok: true,
      source: { type: 'GIT', repoUrl: repository.value.url, ...(body.ref ? { ref: body.ref } : {}) },
    };
  }

  if (body.repoUrl !== undefined || body.ref !== undefined) {
    return {
      ok: false,
      error: 'INVALID_SOURCE',
      message: 'repoUrl/ref are only allowed for a GIT project',
    };
  }
  const { path } = body;
  if (!path) return { ok: false, error: 'INVALID_SOURCE', message: 'path is required' };
  if (!isWithinScanRoot(path, scanRoot)) {
    return { ok: false, error: 'PATH_NOT_ALLOWED', message: 'path is outside the allowed scan root' };
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return {
      ok: false,
      error: 'PATH_NOT_FOUND',
      message: `path does not exist or is not a directory: ${path}`,
    };
  }
  return { ok: true, source: { type: 'LOCAL', path } };
}

export function createProjectRoutes(container: Container): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: CreateProjectBody }>(
      '/projects',
      { schema: createProjectSchema },
      async (request, reply) => {
        const validation = validateProjectSource(request.body, container.scanRoot);
        if (!validation.ok) {
          return reply.code(400).send({ error: validation.error, message: validation.message });
        }

        const project = await container.projectRepository.create({
          name: request.body.name,
          source: validation.source,
        });
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
              ...(loaded.scan.commitSha ? { commitSha: loaded.scan.commitSha } : {}),
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
        const endpointsAnalyzed = loaded ? springStageSucceeded(loaded.scan) : false;
        const endpointCount =
          loaded && endpointsAnalyzed
            ? (await container.endpointRepository.listEndpoints(loaded.scan.id)).length
            : null;
        const dto: ProjectSummaryDto = {
          project: toProjectDto(project),
          latestScan: loaded
            ? {
                scanId: loaded.scan.id,
                state: loaded.scan.state,
                startedAt: loaded.scan.startedAt,
                finishedAt: loaded.scan.finishedAt,
                ...(loaded.scan.commitSha ? { commitSha: loaded.scan.commitSha } : {}),
                stages: loaded.scan.stages,
                dependencies: loaded.summary.dependencies,
                vulnerabilities: loaded.summary.vulnerabilities,
                findings: loaded.summary.findings,
                bySeverity: loaded.summary.bySeverity,
                usedVulnerabilities: loaded.summary.usedVulnerabilities,
                endpoints: endpointCount,
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
      '/projects/:projectId/endpoints',
      async (request, reply) => {
        const project = await container.projectRepository.findById(request.params.projectId);
        if (!project) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
        }

        const scans = await container.scanRepository.listByProject(project.id);
        const latestScan = scans[0];
        if (!latestScan) {
          const empty: ProjectEndpointsDto = { scanId: null, analyzed: false, endpoints: [] };
          return empty;
        }

        const stage = latestScan.stages.find((s) => s.stage === 'SPRING_ENDPOINT');
        const analyzed = springStageSucceeded(latestScan);
        const endpoints = analyzed ? await container.endpointRepository.listEndpoints(latestScan.id) : [];
        const dto: ProjectEndpointsDto = {
          scanId: latestScan.id,
          analyzed,
          ...(stage ? { stage } : {}),
          endpoints: endpoints.map(toSpringEndpointDto),
        };
        return dto;
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
