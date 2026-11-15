import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessResult, ProcessRunner } from '@vulntrace/dependency-analyzer';
import type { Result } from '@vulntrace/shared';
import { err, ok } from '@vulntrace/shared';
import { RepositoryFetchError } from './errors.js';
import { parseGitHubRepositoryUrl, validateGitRef } from './githubUrl.js';
import { measureWorkspace } from './measureWorkspace.js';
import type { WorkspaceLimits } from './measureWorkspace.js';
import type { AcquiredRepository, RepositorySource, RepositoryTarget } from './types.js';

type GitTarget = Extract<RepositoryTarget, { type: 'GIT' }>;

export interface GitRepositorySourceOptions {
  /** Hard limit for `git clone` (CLAUDE.md §15). */
  cloneTimeoutMs?: number;
  limits?: Partial<WorkspaceLimits>;
  /** Parent folder for temporary workspaces. Defaults to the OS temp dir. */
  workspaceRoot?: string;
  gitCommand?: string;
}

export const DEFAULT_CLONE_TIMEOUT_MS = 120_000;
export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = {
  maxFiles: 50_000,
  maxBytes: 500 * 1024 * 1024,
};

const MAX_OUTPUT_BYTES = 1024 * 1024;
const STDERR_TAIL_CHARS = 1000;
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Environment for every git call. The repository is untrusted input (CLAUDE.md §16): only the
 * https transport is allowed, git never prompts (a missing/private repo fails instead of
 * waiting for credentials), and LFS objects are not downloaded.
 */
export const GIT_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ALLOW_PROTOCOL: 'https',
  GIT_LFS_SKIP_SMUDGE: '1',
};

/** `-c` overrides placed before every git subcommand. */
export function gitSafetyConfig(hooksDir: string): string[] {
  return [
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    // No stored credentials are offered to the remote; public repositories only for now.
    '-c',
    'credential.helper=',
    // Repository content must not create links pointing outside the workspace.
    '-c',
    'core.symlinks=false',
    // An empty hooks folder: no hook runs during checkout, whatever the user's config says.
    '-c',
    `core.hooksPath=${hooksDir}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'submodule.recurse=false',
    '-c',
    'core.longpaths=true',
  ];
}

export function buildCloneArgs(input: {
  url: string;
  ref?: string;
  destination: string;
  hooksDir: string;
}): string[] {
  return [
    ...gitSafetyConfig(input.hooksDir),
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--no-recurse-submodules',
    '--no-tags',
    ...(input.ref ? ['--branch', input.ref] : []),
    // `--` ends option parsing: nothing after it can be read as a flag.
    '--',
    input.url,
    input.destination,
  ];
}

/**
 * Last part of git's stderr, with the temporary workspace path replaced: the reason is stored
 * with the scan, and a path to a folder that is deleted right after is noise, not evidence.
 */
function stderrTail(result: ProcessResult, workspace: string): string {
  const text = result.stderr.trim().split(workspace).join('<workspace>');
  return text.length > STDERR_TAIL_CHARS ? `…${text.slice(-STDERR_TAIL_CHARS)}` : text;
}

/**
 * Fetches a public GitHub repository with a shallow clone into a fresh temporary folder.
 * The code is never built or executed here; the folder is handed to the static analyzers and
 * removed by `release()`.
 */
export class GitRepositorySource implements RepositorySource<GitTarget> {
  private readonly cloneTimeoutMs: number;
  private readonly limits: WorkspaceLimits;
  private readonly gitCommand: string;

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly options: GitRepositorySourceOptions = {},
  ) {
    this.cloneTimeoutMs = options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
    this.limits = { ...DEFAULT_WORKSPACE_LIMITS, ...options.limits };
    this.gitCommand = options.gitCommand ?? 'git';
  }

  async acquire(target: GitTarget): Promise<Result<AcquiredRepository, RepositoryFetchError>> {
    const repository = parseGitHubRepositoryUrl(target.repoUrl);
    if (!repository.ok) return repository;
    if (target.ref !== undefined) {
      const ref = validateGitRef(target.ref);
      if (!ref.ok) return ref;
    }

    let workspace: string;
    try {
      workspace = await mkdtemp(join(this.options.workspaceRoot ?? tmpdir(), 'vulntrace-repo-'));
    } catch (cause) {
      return err(
        new RepositoryFetchError('WORKSPACE_FAILED', 'cannot create a temporary workspace', {
          cause,
        }),
      );
    }

    let released = false;
    const release = async () => {
      if (released) return {};
      released = true;
      try {
        await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return {};
      } catch (cause) {
        return {
          warning: `temporary workspace could not be removed: ${workspace} (${(cause as Error).message})`,
        };
      }
    };
    const fail = async (error: RepositoryFetchError) => {
      await release();
      return err(error);
    };

    const hooksDir = join(workspace, 'hooks');
    const workDir = join(workspace, 'repo');
    try {
      await mkdir(hooksDir);
    } catch (cause) {
      return fail(
        new RepositoryFetchError('WORKSPACE_FAILED', 'cannot prepare the workspace', { cause }),
      );
    }

    const clone = await this.processRunner.run(
      this.gitCommand,
      buildCloneArgs({
        url: repository.value.url,
        ref: target.ref,
        destination: workDir,
        hooksDir,
      }),
      {
        cwd: workspace,
        timeoutMs: this.cloneTimeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        env: GIT_ENV,
      },
    );
    if (clone.spawnError) {
      return fail(
        new RepositoryFetchError(
          'GIT_NOT_AVAILABLE',
          `failed to start git (${clone.spawnError.message}). Is git installed and on PATH?`,
        ),
      );
    }
    if (clone.timedOut) {
      return fail(
        new RepositoryFetchError(
          'CLONE_TIMEOUT',
          `git clone timed out after ${this.cloneTimeoutMs}ms`,
        ),
      );
    }
    if (clone.exitCode !== 0) {
      return fail(
        new RepositoryFetchError(
          'CLONE_FAILED',
          `git clone of ${repository.value.url}${target.ref ? ` (${target.ref})` : ''} exited with code ${clone.exitCode}: ${stderrTail(clone, workspace)}`,
        ),
      );
    }

    const size = await measureWorkspace(workDir, this.limits);
    if (!size.ok) return fail(size.error);

    const head = await this.processRunner.run(
      this.gitCommand,
      [...gitSafetyConfig(hooksDir), 'rev-parse', 'HEAD'],
      { cwd: workDir, timeoutMs: 10_000, maxOutputBytes: 4096, env: GIT_ENV },
    );
    const commitSha = head.stdout.trim();
    if (head.exitCode !== 0 || !SHA_PATTERN.test(commitSha)) {
      return fail(
        new RepositoryFetchError(
          'CLONE_FAILED',
          `cannot read the cloned commit SHA: ${head.spawnError?.message ?? stderrTail(head, workspace)}`,
        ),
      );
    }

    return ok({
      workDir,
      evidence: { type: 'GIT', repoUrl: repository.value.url, ref: target.ref, commitSha },
      release,
    });
  }
}
