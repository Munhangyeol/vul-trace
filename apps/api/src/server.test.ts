import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  EndpointRepository,
  FindingRepository,
  ProjectRepository,
  ScanRepository,
  StoredFinding,
} from '@vulntrace/core';
import type { GitRepositoryPort } from '@vulntrace/core';
import { createRepositoryScanRunner, silentScanLogger } from '@vulntrace/core';
import { ok } from '@vulntrace/shared';
import type {
  Project,
  ProjectDependency,
  ProjectSource,
  ScanJob,
  SpringEndpoint,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import type { Container } from './container.js';
import { buildServer } from './server.js';

class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects: Project[] = [];

  async create(input: { name: string; source: ProjectSource }): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      source: input.source,
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
  private readonly findingsByScan = new Map<string, StoredFinding[]>();
  private readonly findingsById = new Map<string, StoredFinding>();

  async saveDependencies(scanId: string, dependencies: ProjectDependency[]): Promise<void> {
    this.dependenciesByScan.set(scanId, dependencies);
  }

  async saveFindings(scanId: string, findings: VulnerabilityFinding[]): Promise<void> {
    const stored = findings.map(
      (finding, index): StoredFinding => ({ id: `${scanId}:${index}`, finding }),
    );
    this.findingsByScan.set(scanId, stored);
    for (const s of stored) this.findingsById.set(s.id, s);
  }

  async listDependencies(scanId: string): Promise<ProjectDependency[]> {
    return this.dependenciesByScan.get(scanId) ?? [];
  }

  async listFindings(scanId: string): Promise<StoredFinding[]> {
    return this.findingsByScan.get(scanId) ?? [];
  }

  async findFindingById(findingId: string): Promise<StoredFinding | null> {
    return this.findingsById.get(findingId) ?? null;
  }
}

class InMemoryEndpointRepository implements EndpointRepository {
  private readonly endpointsByScan = new Map<string, SpringEndpoint[]>();

  async saveEndpoints(scanId: string, endpoints: SpringEndpoint[]): Promise<void> {
    this.endpointsByScan.set(scanId, endpoints);
  }

  async listEndpoints(scanId: string): Promise<SpringEndpoint[]> {
    return this.endpointsByScan.get(scanId) ?? [];
  }
}

const FAKE_SHA = 'c'.repeat(40);

/**
 * Stands in for a real clone (no network in base tests): "clones" by pointing at a fixture
 * folder, and counts releases so the test can check the workspace is always cleaned up.
 */
class FixtureGitSource implements GitRepositoryPort {
  releases = 0;

  async acquire(target: { type: 'GIT'; repoUrl: string; ref?: string }) {
    return ok({
      workDir: fixturePath('spring-vulnerable-used'),
      evidence: {
        type: 'GIT' as const,
        repoUrl: target.repoUrl,
        ref: target.ref,
        commitSha: FAKE_SHA,
      },
      release: async () => {
        this.releases += 1;
        return {};
      },
    });
  }
}

const gitSource = new FixtureGitSource();

function testContainer(): Container {
  return {
    scanRunner: createRepositoryScanRunner({ logger: silentScanLogger, gitSource }),
    projectRepository: new InMemoryProjectRepository(),
    scanRepository: new InMemoryScanRepository(),
    findingRepository: new InMemoryFindingRepository(),
    endpointRepository: new InMemoryEndpointRepository(),
  };
}

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

const container = testContainer();
const app = buildServer(container);

afterAll(async () => {
  await app.close();
});

describe('api server', () => {
  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/projects/:projectId/vulnerabilities returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/any-id/vulnerabilities' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/findings/:findingId returns 404 for an unknown finding', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/findings/does-not-exist' });
    expect(res.statusCode).toBe(404);
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

    // checkVulnerabilities: false — this test wires the real OsvVulnerabilityProvider, and base
    // tests must pass without network access (Phase 2 plan §5).
    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });
    expect(scanRes.statusCode).toBe(201);
    const scan = scanRes.json() as {
      id: string;
      state: string;
      unresolvedDependencies: unknown[];
      vulnerabilityCoverage: { checked: number; notChecked: number; failed: number };
    };
    expect(scan.state).toBe('COMPLETED');
    expect(scan.unresolvedDependencies).toHaveLength(2);
    expect(scan.vulnerabilityCoverage).toEqual({ checked: 0, notChecked: 2, failed: 0 });

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

  it('exposes a saved finding through GET /vulnerabilities and GET /findings/:id (no network — seeded directly)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'finding-demo', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };

    const scan: ScanJob = {
      id: randomUUID(),
      projectId: project.id,
      state: 'COMPLETED',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stages: [],
      unresolvedDependencies: [],
      vulnerabilityCoverage: { checked: 1, notChecked: 0, failed: 0 },
    };
    await container.scanRepository.save(scan);

    const dependency: ProjectDependency = {
      coordinate: {
        groupId: 'org.apache.commons',
        artifactId: 'commons-text',
        version: '1.9',
        scope: 'compile',
        direct: true,
        purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      },
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    };
    await container.findingRepository.saveDependencies(scan.id, [dependency]);

    const finding: VulnerabilityFinding = {
      vulnerability: {
        id: 'GHSA-599f-7c49-w659',
        aliases: ['CVE-2022-42889'],
        summary: 'Arbitrary code execution in Apache Commons Text',
        severity: 'CRITICAL',
        severitySource: 'CVSS_V3',
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
        modified: '2024-02-16T08:09:06.872Z',
        references: ['https://nvd.nist.gov/vuln/detail/CVE-2022-42889'],
      },
      package: {
        ecosystem: 'Maven',
        name: 'org.apache.commons:commons-text',
        version: '1.9',
        purl: dependency.coordinate.purl,
      },
      fixedVersions: ['1.10.0'],
      evidence: {
        provider: 'OSV',
        queriedAt: '2026-09-26T00:00:00.000Z',
        affectedRanges: [{ type: 'ECOSYSTEM', events: [{ introduced: '1.5' }, { fixed: '1.10.0' }] }],
        affectedVersions: ['1.5', '1.6', '1.7', '1.8', '1.9'],
      },
    };
    await container.findingRepository.saveFindings(scan.id, [finding]);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/vulnerabilities`,
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as {
      findings: Array<{ findingId: string; displayId: string; severity: string }>;
      coverage: { checked: number };
    };
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]?.displayId).toBe('CVE-2022-42889');
    expect(body.findings[0]?.severity).toBe('CRITICAL');
    expect(body.coverage).toEqual({ checked: 1, notChecked: 0, failed: 0 });

    const findingId = body.findings[0]!.findingId;
    const detailRes = await app.inject({ method: 'GET', url: `/api/findings/${findingId}` });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json()).toMatchObject({
      findingId,
      vulnerabilityId: 'GHSA-599f-7c49-w659',
      displayId: 'CVE-2022-42889',
      fixedVersions: ['1.10.0'],
    });
  });

  it('GET /api/projects includes a latestScan summary after a scan, and omits it before one', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'list-summary', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };

    const beforeScanList = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as Array<{
      id: string;
      latestScan?: unknown;
    }>;
    expect(beforeScanList.find((p) => p.id === project.id)?.latestScan).toBeUndefined();

    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });

    const afterScanList = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as Array<{
      id: string;
      latestScan?: { state: string; dependencyCount: number; vulnerabilityCount: number };
    }>;
    const item = afterScanList.find((p) => p.id === project.id);
    expect(item?.latestScan).toMatchObject({
      state: 'COMPLETED',
      dependencyCount: 3,
      vulnerabilityCount: 0,
    });
  });

  it('GET /api/projects/:projectId/summary is null before a scan and populated after', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'dashboard-summary', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };

    const beforeRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/summary`,
    });
    expect(beforeRes.statusCode).toBe(200);
    expect(beforeRes.json()).toMatchObject({ latestScan: null });

    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });

    const afterRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/summary`,
    });
    expect(afterRes.statusCode).toBe(200);
    expect(afterRes.json()).toMatchObject({
      project: { id: project.id },
      latestScan: {
        state: 'COMPLETED',
        dependencies: 3,
        vulnerabilities: 0,
        endpoints: 1,
        unresolvedDependencies: expect.arrayContaining([expect.objectContaining({ artifactId: expect.any(String) })]),
      },
    });
  });

  it('GET /api/projects/:projectId/summary returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/unknown-id/summary' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/projects/:projectId/vulnerabilities returns findings sorted by severity then CVSS', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'sort-order', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };

    const scan: ScanJob = {
      id: randomUUID(),
      projectId: project.id,
      state: 'COMPLETED',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stages: [],
      unresolvedDependencies: [],
      vulnerabilityCoverage: { checked: 2, notChecked: 0, failed: 0 },
    };
    await container.scanRepository.save(scan);

    const depA: ProjectDependency = {
      coordinate: {
        groupId: 'com.example',
        artifactId: 'a',
        version: '1.0',
        scope: 'compile',
        direct: true,
        purl: 'pkg:maven/com.example/a@1.0',
      },
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    };
    const depB: ProjectDependency = {
      coordinate: {
        groupId: 'com.example',
        artifactId: 'b',
        version: '1.0',
        scope: 'compile',
        direct: true,
        purl: 'pkg:maven/com.example/b@1.0',
      },
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    };
    await container.findingRepository.saveDependencies(scan.id, [depA, depB]);

    const lowFinding: VulnerabilityFinding = {
      vulnerability: {
        id: 'CVE-2020-1',
        aliases: ['CVE-2020-1'],
        summary: 'low severity issue',
        severity: 'LOW',
        severitySource: 'CVSS_V3',
        cvssScore: 2.0,
        modified: '2020-01-01T00:00:00.000Z',
        references: [],
      },
      package: { ecosystem: 'Maven', name: 'com.example:a', version: '1.0', purl: depA.coordinate.purl },
      fixedVersions: [],
      evidence: { provider: 'OSV', queriedAt: new Date().toISOString(), affectedRanges: [], affectedVersions: [] },
    };
    const criticalFinding: VulnerabilityFinding = {
      vulnerability: {
        id: 'CVE-2020-2',
        aliases: ['CVE-2020-2'],
        summary: 'critical severity issue',
        severity: 'CRITICAL',
        severitySource: 'CVSS_V3',
        cvssScore: 9.1,
        modified: '2020-01-01T00:00:00.000Z',
        references: [],
      },
      package: { ecosystem: 'Maven', name: 'com.example:b', version: '1.0', purl: depB.coordinate.purl },
      fixedVersions: [],
      evidence: { provider: 'OSV', queriedAt: new Date().toISOString(), affectedRanges: [], affectedVersions: [] },
    };
    // Saved in LOW-then-CRITICAL order to prove the response is sorted, not insertion order.
    await container.findingRepository.saveFindings(scan.id, [lowFinding, criticalFinding]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/vulnerabilities`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { findings: Array<{ displayId: string; severity: string }> };
    expect(body.findings.map((f) => f.displayId)).toEqual(['CVE-2020-2', 'CVE-2020-1']);
  });

  it('exposes source usage evidence through the finding DTO, GET /findings/:id/usages and the summary', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'usage-demo', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };

    const scan: ScanJob = {
      id: randomUUID(),
      projectId: project.id,
      state: 'COMPLETED',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stages: [{ stage: 'SOURCE_USAGE', status: 'SUCCEEDED' }],
      unresolvedDependencies: [],
      vulnerabilityCoverage: { checked: 1, notChecked: 0, failed: 0 },
    };
    await container.scanRepository.save(scan);

    const purl = 'pkg:maven/org.apache.commons/commons-text@1.9';
    const location = { filePath: 'src/main/java/com/example/demo/TemplateService.java', line: 14, column: 60 };
    const finding: VulnerabilityFinding = {
      vulnerability: {
        id: 'GHSA-599f-7c49-w659',
        aliases: ['CVE-2022-42889'],
        summary: 'Arbitrary code execution in Apache Commons Text',
        severity: 'CRITICAL',
        severitySource: 'CVSS_V3',
        modified: '2024-02-16T08:09:06.872Z',
        references: [],
      },
      package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl },
      fixedVersions: ['1.10.0'],
      evidence: { provider: 'OSV', queriedAt: '2026-10-04T00:00:00.000Z', affectedRanges: [], affectedVersions: [] },
      usage: {
        used: true,
        vulnerableApi: 'USED',
        packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
        vulnerableApis: [{ type: 'org.apache.commons.text.StringSubstitutor', method: 'createInterpolator' }],
        usages: [
          {
            kind: 'METHOD_CALL',
            symbol: 'org.apache.commons.text.StringSubstitutor#createInterpolator',
            dependencyPurl: purl,
            sourceSet: 'MAIN',
            vulnerableApi: true,
            evidence: { location, snippet: 'StringSubstitutor.createInterpolator();' },
          },
        ],
      },
    };
    await container.findingRepository.saveFindings(scan.id, [finding]);

    const listRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/vulnerabilities` });
    const body = listRes.json() as { findings: Array<{ findingId: string; usage: unknown }> };
    expect(body.findings[0]?.usage).toEqual({
      used: true,
      vulnerableApi: 'USED',
      packageMapping: { packages: ['org.apache.commons.text'], basis: 'CURATED' },
      vulnerableApis: [{ type: 'org.apache.commons.text.StringSubstitutor', method: 'createInterpolator' }],
      mainUsageCount: 1,
      testUsageCount: 0,
    });

    const findingId = body.findings[0]!.findingId;
    const usagesRes = await app.inject({ method: 'GET', url: `/api/findings/${findingId}/usages` });
    expect(usagesRes.statusCode).toBe(200);
    expect(usagesRes.json()).toMatchObject({
      findingId,
      analyzed: true,
      usages: [
        {
          kind: 'METHOD_CALL',
          symbol: 'org.apache.commons.text.StringSubstitutor#createInterpolator',
          sourceSet: 'MAIN',
          vulnerableApi: true,
          filePath: location.filePath,
          line: 14,
          column: 60,
        },
      ],
    });

    const summaryRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/summary` });
    expect(summaryRes.json()).toMatchObject({ latestScan: { usedVulnerabilities: 1 } });
  });

  it('GET /api/findings/:findingId/usages returns 404 for an unknown finding', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/findings/does-not-exist/usages' });
    expect(res.statusCode).toBe(404);
  });

  it('a real scan runs the SOURCE_USAGE stage', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'source-stage', path: fixturePath('spring-vulnerable-used') },
    });
    const project = createRes.json() as { id: string };
    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });
    const scan = scanRes.json() as { stages: Array<{ stage: string; status: string }> };
    expect(scan.stages).toContainEqual({ stage: 'SOURCE_USAGE', status: 'SUCCEEDED' });
  });

  it('a real scan stores Spring endpoints with evidence and serves them from GET /endpoints', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'endpoints', path: fixturePath('spring-vulnerable-reachable') },
    });
    const project = createRes.json() as { id: string };

    const beforeRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/endpoints` });
    expect(beforeRes.statusCode).toBe(200);
    expect(beforeRes.json()).toEqual({ scanId: null, analyzed: false, endpoints: [] });

    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });
    const scan = scanRes.json() as { id: string; stages: Array<{ stage: string; status: string }> };
    expect(scan.stages).toContainEqual({ stage: 'SPRING_ENDPOINT', status: 'SUCCEEDED' });

    const res = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/endpoints` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      scanId: scan.id,
      analyzed: true,
      stage: { stage: 'SPRING_ENDPOINT', status: 'SUCCEEDED' },
      endpoints: [
        expect.objectContaining({ httpMethod: 'GET', path: '/api/hello' }),
        {
          httpMethod: 'POST',
          path: '/api/templates/render',
          controllerClass: 'com.example.demo.TemplateController',
          controllerMethod: 'render',
          filePath: 'src/main/java/com/example/demo/TemplateController.java',
          line: 19,
          column: 19,
          unresolved: [],
          evidence: {
            controller: {
              annotation: '@RestController',
              location: { filePath: 'src/main/java/com/example/demo/TemplateController.java', line: 8, column: 1 },
            },
            classMapping: {
              annotation: '@RequestMapping("/api/templates")',
              location: { filePath: 'src/main/java/com/example/demo/TemplateController.java', line: 9, column: 1 },
            },
            methodMapping: {
              annotation: '@PostMapping("/render")',
              location: { filePath: 'src/main/java/com/example/demo/TemplateController.java', line: 18, column: 5 },
            },
          },
        },
      ],
    });
  });

  it('GET /api/projects/:projectId/endpoints returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${randomUUID()}/endpoints` });
    expect(res.statusCode).toBe(404);
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

describe('GitHub repository projects', () => {
  it('registers a GIT project with a normalized URL and no local path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: 'petclinic',
        sourceType: 'GIT',
        repoUrl: 'https://github.com/spring-projects/spring-petclinic.git',
        ref: 'main',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      sourceType: 'GIT',
      repoUrl: 'https://github.com/spring-projects/spring-petclinic',
      ref: 'main',
    });
    expect(body).not.toHaveProperty('path');
  });

  it('keeps accepting the legacy { name, path } body as a LOCAL project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'legacy', path: fixturePath('spring-safe-app') },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sourceType: 'LOCAL', path: fixturePath('spring-safe-app') });
  });

  it.each([
    [{ sourceType: 'GIT', repoUrl: 'file:///etc' }, 'INVALID_REPOSITORY_URL'],
    [{ sourceType: 'GIT', repoUrl: 'https://user:token@github.com/a/b' }, 'INVALID_REPOSITORY_URL'],
    [
      { sourceType: 'GIT', repoUrl: 'https://github.com/a/b', ref: '--upload-pack=x' },
      'INVALID_REF',
    ],
    [{ sourceType: 'GIT' }, 'INVALID_SOURCE'],
    [{ sourceType: 'GIT', repoUrl: 'https://github.com/a/b', path: '.' }, 'INVALID_SOURCE'],
    [{ sourceType: 'LOCAL', path: '.', repoUrl: 'https://github.com/a/b' }, 'INVALID_SOURCE'],
  ])('rejects %o', async (payload, error) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'x', ...payload },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error });
  });

  it('scans a GIT project, records the commit SHA, and stores repository-relative evidence', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'git-demo', sourceType: 'GIT', repoUrl: 'https://github.com/example/demo' },
    });
    const project = createRes.json() as { id: string };
    const releasesBefore = gitSource.releases;

    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/scans`,
      payload: { checkVulnerabilities: false },
    });
    expect(scanRes.statusCode).toBe(201);
    const scan = scanRes.json() as {
      commitSha?: string;
      stages: { stage: string; status: string }[];
    };
    expect(scan.commitSha).toBe(FAKE_SHA);
    expect(scan.stages[0]).toEqual({ stage: 'REPOSITORY_FETCH', status: 'SUCCEEDED' });
    expect(gitSource.releases).toBe(releasesBefore + 1);

    const depsRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/dependencies`,
    });
    const dependencies = depsRes.json() as { source: { filePath: string } }[];
    expect(dependencies.length).toBeGreaterThan(0);
    expect(dependencies.every((d) => d.source.filePath === 'pom.xml')).toBe(true);

    const summaryRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/summary`,
    });
    expect(summaryRes.json()).toMatchObject({ latestScan: { commitSha: FAKE_SHA } });

    const listRes = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(listRes.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: project.id,
          latestScan: expect.objectContaining({ commitSha: FAKE_SHA }),
        }),
      ]),
    );
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
