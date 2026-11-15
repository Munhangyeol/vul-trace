import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '@vulntrace/dependency-analyzer';
import { GIT_ENV, GitRepositorySource } from './GitRepositorySource.js';

const SHA = 'a'.repeat(40);

interface Call {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
}

interface FakeGitBehaviour {
  clone?: Partial<ProcessResult>;
  files?: Record<string, string>;
  revParse?: Partial<ProcessResult>;
}

/** Fake git: `clone` writes the given files into the destination; `rev-parse` prints a SHA. */
class FakeGit implements ProcessRunner {
  readonly calls: Call[] = [];

  constructor(private readonly behaviour: FakeGitBehaviour = {}) {}

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.calls.push({ command, args, options });
    const base: ProcessResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    if (args.includes('clone')) {
      const result = { ...base, ...this.behaviour.clone };
      if (result.exitCode === 0 && !result.timedOut && !result.spawnError) {
        const destination = args[args.length - 1] as string;
        mkdirSync(join(destination, '.git'), { recursive: true });
        const files = this.behaviour.files ?? { 'pom.xml': '<project/>' };
        for (const [path, content] of Object.entries(files)) {
          mkdirSync(dirname(join(destination, path)), { recursive: true });
          writeFileSync(join(destination, path), content);
        }
      }
      return result;
    }
    return { ...base, stdout: `${SHA}\n`, ...this.behaviour.revParse };
  }
}

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'vulntrace-git-test-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

/** Every acquire() creates exactly one folder under workspaceRoot; none may survive a release. */
function leftoverWorkspaces(): string[] {
  return readdirSync(workspaceRoot);
}

const REPO = 'https://github.com/a/b';

describe('GitRepositorySource', () => {
  it('shallow-clones with hardened options and records the commit SHA', async () => {
    const git = new FakeGit();
    const source = new GitRepositorySource(git, { workspaceRoot });

    const result = await source.acquire({
      type: 'GIT',
      repoUrl: 'https://github.com/spring-projects/spring-petclinic.git',
      ref: 'main',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence).toEqual({
      type: 'GIT',
      repoUrl: 'https://github.com/spring-projects/spring-petclinic',
      ref: 'main',
      commitSha: SHA,
    });
    expect(existsSync(join(result.value.workDir, 'pom.xml'))).toBe(true);

    const clone = git.calls[0];
    expect(clone?.command).toBe('git');
    expect(clone?.options.env).toEqual(GIT_ENV);
    const args = clone?.args ?? [];
    for (const config of [
      'protocol.allow=never',
      'protocol.https.allow=always',
      'credential.helper=',
      'core.symlinks=false',
      'core.fsmonitor=false',
      'submodule.recurse=false',
    ]) {
      expect(args).toContain(config);
    }
    expect(args.some((a) => a.startsWith('core.hooksPath='))).toBe(true);
    expect(args.slice(args.indexOf('clone'))).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--no-recurse-submodules',
      '--no-tags',
      '--branch',
      'main',
      '--',
      'https://github.com/spring-projects/spring-petclinic',
      result.value.workDir,
    ]);

    await result.value.release();
    expect(leftoverWorkspaces()).toEqual([]);
  });

  it('omits the branch option when no ref is given', async () => {
    const git = new FakeGit();
    const result = await new GitRepositorySource(git, { workspaceRoot }).acquire({
      type: 'GIT',
      repoUrl: REPO,
    });
    expect(result.ok).toBe(true);
    expect(git.calls[0]?.args).not.toContain('--branch');
    if (result.ok) await result.value.release();
  });

  it('rejects invalid URLs and refs without running git', async () => {
    const git = new FakeGit();
    const source = new GitRepositorySource(git, { workspaceRoot });

    const badUrl = await source.acquire({ type: 'GIT', repoUrl: 'file:///etc' });
    const badRef = await source.acquire({ type: 'GIT', repoUrl: REPO, ref: '--upload-pack=x' });

    expect(badUrl.ok || badUrl.error.code).toBe('INVALID_REPOSITORY_URL');
    expect(badRef.ok || badRef.error.code).toBe('INVALID_REF');
    expect(git.calls).toHaveLength(0);
    expect(leftoverWorkspaces()).toEqual([]);
  });

  it.each([
    [
      { exitCode: 128, stderr: 'fatal: repository not found' },
      'CLONE_FAILED',
      /exited with code 128: fatal: repository not found/,
    ],
    [{ exitCode: null, timedOut: true }, 'CLONE_TIMEOUT', /timed out after 5ms/],
    [{ exitCode: null, spawnError: new Error('spawn git ENOENT') }, 'GIT_NOT_AVAILABLE', /ENOENT/],
  ] as const)(
    'reports a failed clone (%o) and removes the workspace',
    async (clone, code, message) => {
      const source = new GitRepositorySource(new FakeGit({ clone }), {
        workspaceRoot,
        cloneTimeoutMs: 5,
      });
      const result = await source.acquire({ type: 'GIT', repoUrl: REPO });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(code);
      expect(result.error.message).toMatch(message);
      expect(leftoverWorkspaces()).toEqual([]);
    },
  );

  it('keeps the temporary workspace path out of the stored failure reason', async () => {
    class EchoPathGit extends FakeGit {
      override async run(command: string, args: readonly string[], options: ProcessRunOptions) {
        const destination = args[args.length - 1] as string;
        await super.run(command, args, options);
        return {
          exitCode: 128,
          stdout: '',
          stderr: `Cloning into '${destination}'...\nfatal: repository not found`,
          timedOut: false,
        };
      }
    }
    const result = await new GitRepositorySource(new EchoPathGit({ clone: { exitCode: 128 } }), {
      workspaceRoot,
    }).acquire({ type: 'GIT', repoUrl: REPO });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(`Cloning into '<workspace>`);
    expect(result.error.message).not.toContain(workspaceRoot);
  });

  it('fails when the checkout exceeds the workspace limits', async () => {
    const git = new FakeGit({ files: { 'pom.xml': 'x', 'a.txt': 'x', 'src/b.txt': 'x' } });
    const source = new GitRepositorySource(git, { workspaceRoot, limits: { maxFiles: 2 } });

    const result = await source.acquire({ type: 'GIT', repoUrl: REPO });

    expect(result.ok || result.error.code).toBe('REPOSITORY_TOO_LARGE');
    expect(leftoverWorkspaces()).toEqual([]);
  });

  it('does not count .git contents toward the limits', async () => {
    const git = new FakeGit({ files: { 'pom.xml': 'x', '.git/objects/pack': 'x'.repeat(100) } });
    const source = new GitRepositorySource(git, {
      workspaceRoot,
      limits: { maxFiles: 1, maxBytes: 10 },
    });

    const result = await source.acquire({ type: 'GIT', repoUrl: REPO });

    expect(result.ok).toBe(true);
    if (result.ok) await result.value.release();
  });

  it('fails when the commit SHA cannot be read', async () => {
    const git = new FakeGit({ revParse: { stdout: 'not-a-sha' } });
    const result = await new GitRepositorySource(git, { workspaceRoot }).acquire({
      type: 'GIT',
      repoUrl: REPO,
    });

    expect(result.ok || result.error.code).toBe('CLONE_FAILED');
    expect(leftoverWorkspaces()).toEqual([]);
  });

  it('release() is idempotent', async () => {
    const result = await new GitRepositorySource(new FakeGit(), { workspaceRoot }).acquire({
      type: 'GIT',
      repoUrl: REPO,
    });
    if (!result.ok) throw result.error;
    expect(await result.value.release()).toEqual({});
    expect(await result.value.release()).toEqual({});
    expect(leftoverWorkspaces()).toEqual([]);
  });
});
