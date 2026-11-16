import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, ok } from '@vulntrace/shared';
import { LocalPathSource, RepositoryFetchError } from '@vulntrace/repository-source';
import type {
  AcquiredRepository,
  RepositorySource,
  RepositoryTarget,
} from '@vulntrace/repository-source';
import { relativizeReportPaths, RepositoryScanRunner } from './RepositoryScanRunner.js';
import type { ScanOrchestrator, ScanReport } from './ScanOrchestrator.js';
import { silentScanLogger } from './logging/ScanLogger.js';

type GitTarget = Extract<RepositoryTarget, { type: 'GIT' }>;

const WORK_DIR = resolve('/tmp/vulntrace-repo-x/repo');
const SHA = 'b'.repeat(40);

function reportFor(projectPath: string): ScanReport {
  const pomPath = join(projectPath, 'pom.xml');
  return {
    projectPath,
    state: 'COMPLETED',
    startedAt: '2026-11-15T00:00:00.000Z',
    finishedAt: '2026-11-15T00:00:01.000Z',
    stages: [
      { stage: 'PROJECT_DETECTION', status: 'SUCCEEDED' },
      { stage: 'DEPENDENCY_TREE', status: 'SKIPPED', reason: `maven disabled for ${projectPath}` },
    ],
    project: { groupId: 'g', artifactId: 'a', version: '1', pomPath },
    endpoints: [],
    dependencies: [
      {
        coordinate: {
          groupId: 'org.apache.commons',
          artifactId: 'commons-text',
          version: '1.9',
          scope: 'compile',
          direct: true,
          purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
        },
        source: { kind: 'pom.xml', filePath: pomPath },
      },
    ],
    unresolvedDependencies: [],
    findings: [],
    vulnerabilityCoverage: { checked: 1, notChecked: 0, failed: 0 },
    warnings: [`parsed ${pomPath}`],
  };
}

class FakeOrchestrator {
  readonly paths: string[] = [];
  constructor(private readonly behaviour: 'ok' | 'throw' = 'ok') {}
  async run(projectPath: string): Promise<ScanReport> {
    this.paths.push(projectPath);
    if (this.behaviour === 'throw') throw new Error('boom');
    return reportFor(projectPath);
  }
}

class FakeGitSource implements RepositorySource<GitTarget> {
  releases = 0;
  constructor(private readonly outcome: 'ok' | 'fail' | 'leak' = 'ok') {}
  async acquire(target: GitTarget) {
    if (this.outcome === 'fail') {
      return err(new RepositoryFetchError('CLONE_FAILED', 'repository not found'));
    }
    const acquired: AcquiredRepository = {
      workDir: WORK_DIR,
      evidence: { type: 'GIT', repoUrl: target.repoUrl, ref: target.ref, commitSha: SHA },
      release: async () => {
        this.releases += 1;
        return this.outcome === 'leak'
          ? { warning: 'temporary workspace could not be removed' }
          : {};
      },
    };
    return ok(acquired);
  }
}

function runner(orchestrator: FakeOrchestrator, gitSource: FakeGitSource) {
  return new RepositoryScanRunner({
    orchestrator: orchestrator as unknown as ScanOrchestrator,
    localSource: new LocalPathSource(),
    gitSource,
    logger: silentScanLogger,
    now: () => new Date('2026-11-15T00:00:00.000Z'),
  });
}

describe('RepositoryScanRunner', () => {
  it('scans a local folder in place without a REPOSITORY_FETCH stage', async () => {
    const orchestrator = new FakeOrchestrator();
    const report = await runner(orchestrator, new FakeGitSource()).run({
      type: 'LOCAL',
      path: 'fixtures/app',
    });

    expect(orchestrator.paths).toEqual([resolve('fixtures/app')]);
    expect(report.source).toEqual({ type: 'LOCAL', path: resolve('fixtures/app') });
    expect(report.stages.map((s) => s.stage)).toEqual(['PROJECT_DETECTION', 'DEPENDENCY_TREE']);
    expect(report.dependencies[0]?.source.filePath).toBe(join(resolve('fixtures/app'), 'pom.xml'));
  });

  it('scans a clone, records the commit, rewrites temp paths and removes the workspace', async () => {
    const orchestrator = new FakeOrchestrator();
    const git = new FakeGitSource();
    const report = await runner(orchestrator, git).run({
      type: 'GIT',
      repoUrl: 'https://github.com/a/b',
      ref: 'main',
    });

    expect(orchestrator.paths).toEqual([WORK_DIR]);
    expect(git.releases).toBe(1);
    expect(report.state).toBe('COMPLETED');
    expect(report.projectPath).toBe('https://github.com/a/b');
    expect(report.source).toEqual({
      type: 'GIT',
      repoUrl: 'https://github.com/a/b',
      ref: 'main',
      commitSha: SHA,
    });
    expect(report.stages[0]).toEqual({ stage: 'REPOSITORY_FETCH', status: 'SUCCEEDED' });
    expect(report.project?.pomPath).toBe('pom.xml');
    expect(report.dependencies[0]?.source.filePath).toBe('pom.xml');
    expect(report.stages[2]?.reason).toBe('maven disabled for .');
    expect(report.warnings).toEqual(['parsed pom.xml']);
  });

  it('returns a FAILED report with every analysis stage skipped when the fetch fails', async () => {
    const orchestrator = new FakeOrchestrator();
    const report = await runner(orchestrator, new FakeGitSource('fail')).run({
      type: 'GIT',
      repoUrl: 'https://github.com/a/missing',
    });

    expect(orchestrator.paths).toEqual([]);
    expect(report.state).toBe('FAILED');
    expect(report.source).toEqual({
      type: 'GIT',
      repoUrl: 'https://github.com/a/missing',
      ref: undefined,
    });
    expect(report.stages[0]).toEqual({
      stage: 'REPOSITORY_FETCH',
      status: 'FAILED',
      reason: 'CLONE_FAILED: repository not found',
    });
    expect(report.stages.slice(1).every((s) => s.status === 'SKIPPED')).toBe(true);
    expect(report.stages).toHaveLength(10);
  });

  it('removes the workspace even when the analysis throws', async () => {
    const git = new FakeGitSource();
    await expect(
      runner(new FakeOrchestrator('throw'), git).run({
        type: 'GIT',
        repoUrl: 'https://github.com/a/b',
      }),
    ).rejects.toThrow('boom');
    expect(git.releases).toBe(1);
  });

  it('surfaces a cleanup failure and the Maven opt-in as warnings', async () => {
    const report = await runner(new FakeOrchestrator(), new FakeGitSource('leak')).run(
      { type: 'GIT', repoUrl: 'https://github.com/a/b' },
      { allowMaven: true },
    );

    expect(report.warnings[0]).toMatch(/Maven was enabled for a cloned repository/);
    expect(report.warnings).toContain('temporary workspace could not be removed');
  });
});

describe('relativizeReportPaths', () => {
  it('leaves paths outside the workspace untouched', () => {
    const report = reportFor(resolve('/elsewhere'));
    expect(relativizeReportPaths(report, WORK_DIR).dependencies).toEqual(report.dependencies);
  });
});
