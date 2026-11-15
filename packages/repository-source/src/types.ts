import type { Result } from '@vulntrace/shared';
import type { RepositoryFetchError } from './errors.js';

/** What the user asked to scan. Analyzers never see this — only the resulting folder. */
export type RepositoryTarget =
  { type: 'LOCAL'; path: string } | { type: 'GIT'; repoUrl: string; ref?: string };

/** Evidence of exactly which code was analyzed (CLAUDE.md §6.2). */
export type RepositoryEvidence =
  | { type: 'LOCAL'; path: string }
  | { type: 'GIT'; repoUrl: string; ref?: string; commitSha: string };

export interface AcquiredRepository {
  /** Absolute path of the folder handed to the analyzers. */
  workDir: string;
  evidence: RepositoryEvidence;
  /** Removes anything acquire() created. Safe to call more than once. */
  release(): Promise<RepositoryReleaseResult>;
}

export interface RepositoryReleaseResult {
  /** Set when cleanup failed — the caller surfaces it as a warning rather than hiding it. */
  warning?: string;
}

export interface RepositorySource<T extends RepositoryTarget = RepositoryTarget> {
  acquire(target: T): Promise<Result<AcquiredRepository, RepositoryFetchError>>;
}
