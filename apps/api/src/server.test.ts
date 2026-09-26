import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { FindingRepository, ProjectRepository, ScanRepository } from '@vulntrace/core';
import { createScanOrchestrator, silentScanLogger } from '@vulntrace/core';
import type { Project, ProjectDependency, ScanJob, VulnerabilityFinding } from '@vulntrace/shared';
import type { Container } from './container.js';
import { buildServer } from './server.js';

class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects: Project[] = [];

  async create(input: { name: string; path: string }): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      createdAt: new Date().toISOString(),
    };
    this.projects.push(project);
    return project;
  }

  async findById(projectId: string): Promise<Project | null> {
    return this.projects.find((p) => p.id === projectId) ?? null;
  }

  async list(): Promise<Project[]> {
    return [...this.projects];
  }
}

class InMemoryScanRepository implements ScanRepository {
  private readonly scans: ScanJob[] = [];

  async save(scan: ScanJob): Promise<void> {
    const index = this.scans.findIndex((s) => s.id === scan.id);
    if (index >= 0) this.scans[index] = scan;
    else this.scans.push(scan);
  }

  async findById(scanId: string): Promise<ScanJob | null> {
    return this.scans.find((s) => s.id === scanId) ?? null;
  }

  async listByProject(projectId: string): Promise<ScanJob[]> {
    return this.scans
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}

class InMemoryFindingRepository implements FindingRepository {
  private readonly dependenciesByScan = new Map<string, ProjectDependency[]>();

  async saveDependencies(scanId: string, dependencies: ProjectDependency[]): Promise<void> {
    this.dependenciesByScan.set(scanId, dependencies);
  }

  async saveFindings(): Promise<void> {}

  async listDependencies(scanId: string): Promise<ProjectDependency[]> {
    return this.dependenciesByScan.get(scanId) ?? [];
  }

  async listFindings(): Promise<VulnerabilityFinding[]> {
    return [];
  }
}

function testContainer(): Container {
  return {
    scanOrchestrator: createScanOrchestrator({ logger: silentScanLogger }),
    projectRepository: new InMemoryProjectRepository(),
    scanRepository: new InMemoryScanRepository(),
    findingRepository: new InMemoryFindingRepository(),
  };
}

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const app = buildServer(testContainer());

afterAll(async () => {
  await app.close();
});

describe('api server', () => {
  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/projects/:projectId/vulnerabilities is not implemented yet (Phase 2)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/any-id/vulnerabilities' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'NOT_IMPLEMENTED' });
  });

  it('GET /api/projects/:projectId returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/unknown-id' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/projects rejects a request missing required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/projects rejects a path that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'demo', path: fixturePath('does-not-exist') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('registers a project, runs a scan, and exposes dependencies end-to-end', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'spring-vulnerable-used', path: fixturePath('spring-vulnerable-used') },
    });
    expect(createRes.statusCode).toBe(201);
    const project = createRes.json() as { id: string };

    const listRes = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(listRes.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );

    const getRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ id: project.id });

    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: {},
    });
    expect(scanRes.statusCode).toBe(201);
    const scan = scanRes.json() as { id: string; state: string; unresolvedDependencies: unknown[] };
    expect(scan.state).toBe('COMPLETED');
    expect(scan.unresolvedDependencies).toHaveLength(2);

    const scansListRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/scans`,
    });
    expect(scansListRes.statusCode).toBe(200);
    expect(scansListRes.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: scan.id })]),
    );

    const depsRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/dependencies`,
    });
    expect(depsRes.statusCode).toBe(200);
    const dependencies = depsRes.json() as Array<{ artifactId: string }>;
    expect(dependencies.map((d) => d.artifactId).sort()).toEqual([
      'commons-text',
      'guava',
      'jackson-databind',
    ]);
  });

  it('POST /api/projects/:projectId/scans returns 404 for an unknown project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/unknown-id/scans',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/projects/:projectId/dependencies returns an empty list before any scan', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'safe', path: fixturePath('spring-safe-app') },
    });
    const project = createRes.json() as { id: string };

    const depsRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/dependencies`,
    });
    expect(depsRes.statusCode).toBe(200);
    expect(depsRes.json()).toEqual([]);
  });
});

describe('VULNTRACE_SCAN_ROOT restriction', () => {
  const scanRootApp = buildServer({
    ...testContainer(),
    scanRoot: fixturePath('spring-safe-app'),
  });

  afterAll(async () => {
    await scanRootApp.close();
  });

  it('rejects a path outside the configured scan root', async () => {
    const res = await scanRootApp.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'outside', path: fixturePath('spring-vulnerable-used') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'PATH_NOT_ALLOWED' });
  });

  it('allows the scan root itself', async () => {
    const res = await scanRootApp.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'inside', path: fixturePath('spring-safe-app') },
    });
    expect(res.statusCode).toBe(201);
  });
});
