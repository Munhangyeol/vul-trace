import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '@vulntrace/shared';
import { err, ok } from '@vulntrace/shared';
import { RepositoryFetchError } from './errors.js';

export interface WorkspaceLimits {
  maxFiles: number;
  maxBytes: number;
}

export interface WorkspaceSize {
  files: number;
  bytes: number;
}

/**
 * Counts checked-out files (excluding `.git`) and stops as soon as a limit is crossed.
 * Uses lstat so links are counted, never followed. Runs after the clone, so it bounds what the
 * analyzers read, not what git downloads — the clone timeout covers that.
 */
export async function measureWorkspace(
  root: string,
  limits: WorkspaceLimits,
): Promise<Result<WorkspaceSize, RepositoryFetchError>> {
  const size: WorkspaceSize = { files: 0, bytes: 0 };
  const pending: string[] = [root];

  try {
    while (pending.length > 0) {
      const dir = pending.pop() as string;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (dir === root && entry.name === '.git') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        size.files += 1;
        size.bytes += (await lstat(fullPath)).size;
        if (size.files > limits.maxFiles || size.bytes > limits.maxBytes) {
          return err(
            new RepositoryFetchError(
              'REPOSITORY_TOO_LARGE',
              `repository exceeds the workspace limit (${limits.maxFiles} files / ${limits.maxBytes} bytes)`,
            ),
          );
        }
      }
    }
  } catch (cause) {
    return err(
      new RepositoryFetchError(
        'WORKSPACE_FAILED',
        `cannot inspect the cloned repository: ${(cause as Error).message}`,
        {
          cause,
        },
      ),
    );
  }

  return ok(size);
}
