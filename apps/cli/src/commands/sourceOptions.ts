import { resolve } from 'node:path';
import type { Command } from 'commander';
import { looksLikeRepositoryUrl } from '@vulntrace/core';
import type { RepositoryTarget } from '@vulntrace/core';

export interface SourceCliOptions {
  ref?: string;
}

export const TARGET_ARGUMENT_DESCRIPTION =
  'project root path, or a public GitHub repository URL (https://github.com/<owner>/<repo>)';

export function addSourceOptions(command: Command): Command {
  return command.option(
    '--ref <branch-or-tag>',
    'with a GitHub URL: branch or tag to clone (default: the repository default branch)',
  );
}

/**
 * Anything with a URL scheme is a repository target; the runner validates it (only
 * https://github.com is accepted) and reports a FAILED REPOSITORY_FETCH stage otherwise.
 */
export function toScanTarget(
  input: string,
  options: SourceCliOptions,
): RepositoryTarget | { error: string } {
  if (looksLikeRepositoryUrl(input)) {
    return {
      type: 'GIT',
      repoUrl: input.trim(),
      ...(options.ref !== undefined ? { ref: options.ref } : {}),
    };
  }
  if (options.ref !== undefined) return { error: '--ref can only be used with a repository URL' };
  return { type: 'LOCAL', path: resolve(input) };
}
