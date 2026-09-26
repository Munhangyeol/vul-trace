import { existsSync, statSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../container.js';
import { toProjectDependencyDto } from '../dto/dependency.dto.js';
import { toProjectDto } from '../dto/project.dto.js';
import { toVulnerabilityFindingDto } from '../dto/vulnerability.dto.js';
import { isWithinScanRoot } from '../lib/scanRoot.js';

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
      return projects.map(toProjectDto);
    });

    app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (request, reply) => {
      const project = await container.projectRepository.findById(request.params.projectId);
      if (!project) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'project not found' });
      }
      return toProjectDto(project);
    });

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
        return {
          findings: findings.map(toVulnerabilityFindingDto),
          coverage: latestScan.vulnerabilityCoverage,
        };
      },
    );
  };
}
