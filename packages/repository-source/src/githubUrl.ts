import type { Result } from '@vulntrace/shared';
import { err, ok } from '@vulntrace/shared';
import { RepositoryFetchError } from './errors.js';

export interface GitHubRepository {
  owner: string;
  repo: string;
  /** Normalized `https://github.com/<owner>/<repo>` — the only form ever handed to git. */
  url: string;
}

/** GitHub owner names: alphanumerics and single hyphens, no leading/trailing hyphen. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub repository names: alphanumerics, `.`, `_`, `-`; `.` / `..` are not valid names. */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

/**
 * Accepts only `https://github.com/<owner>/<repo>` (optionally `.git` / trailing slash).
 * Credentials, ports, query strings, fragments, other hosts and other protocols are rejected,
 * so repository input can never steer git to a local path or an `ext::` transport (CLAUDE.md §15).
 */
export function parseGitHubRepositoryUrl(
  input: string,
): Result<GitHubRepository, RepositoryFetchError> {
  const invalid = (detail: string) =>
    err(
      new RepositoryFetchError(
        'INVALID_REPOSITORY_URL',
        `unsupported repository URL (${detail}); expected https://github.com/<owner>/<repo>`,
      ),
    );

  const trimmed = input.trim();
  const match = URL_PATTERN.exec(trimmed);
  if (!match) return invalid('not a https://github.com/<owner>/<repo> URL');

  const [, owner = '', repo = ''] = match;
  if (!OWNER_PATTERN.test(owner) || owner.includes('--') || owner.endsWith('-')) {
    return invalid('invalid owner');
  }
  if (!REPO_PATTERN.test(repo) || repo === '.' || repo === '..')
    return invalid('invalid repository name');

  return ok({ owner, repo, url: `https://github.com/${owner}/${repo}` });
}

/**
 * Branch or tag names only (commit SHAs are out of scope for now). Rejects anything git could
 * read as an option (`-...`) and the constructs `git check-ref-format` forbids.
 */
export function validateGitRef(ref: string): Result<string, RepositoryFetchError> {
  const invalid = (detail: string) =>
    err(new RepositoryFetchError('INVALID_REF', `invalid branch or tag "${ref}" (${detail})`));

  if (ref.length === 0 || ref.length > 200) return invalid('length must be 1-200');
  if (!/^[A-Za-z0-9._/-]+$/.test(ref))
    return invalid('only letters, digits, ".", "_", "/", "-" allowed');
  if (ref.startsWith('-')) return invalid('must not start with "-"');
  if (ref.startsWith('/') || ref.endsWith('/') || ref.includes('//'))
    return invalid('bad "/" placement');
  if (ref.includes('..')) return invalid('must not contain ".."');
  if (ref.endsWith('.') || ref.endsWith('.lock')) return invalid('bad suffix');
  if (ref.split('/').some((part) => part.startsWith('.')))
    return invalid('component starts with "."');
  return ok(ref);
}

/** True when CLI/API input should be treated as a repository URL rather than a local path. */
export function looksLikeRepositoryUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
}
