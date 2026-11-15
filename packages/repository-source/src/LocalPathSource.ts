import { resolve } from 'node:path';
import type { Result } from '@vulntrace/shared';
import { ok } from '@vulntrace/shared';
import type { RepositoryFetchError } from './errors.js';
import type { AcquiredRepository, RepositorySource, RepositoryTarget } from './types.js';

type LocalTarget = Extract<RepositoryTarget, { type: 'LOCAL' }>;

/**
 * The existing behaviour: scan a folder in place. Existence is checked by project detection
 * (PROJECT_DETECTION stage), so this only resolves the path and never deletes anything.
 */
export class LocalPathSource implements RepositorySource<LocalTarget> {
  async acquire(target: LocalTarget): Promise<Result<AcquiredRepository, RepositoryFetchError>> {
    const workDir = resolve(target.path);
    return ok({
      workDir,
      evidence: { type: 'LOCAL', path: workDir },
      release: async () => ({}),
    });
  }
}
