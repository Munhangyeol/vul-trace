export type RepositoryFetchErrorCode =
  | 'INVALID_REPOSITORY_URL'
  | 'INVALID_REF'
  | 'GIT_NOT_AVAILABLE'
  | 'CLONE_FAILED'
  | 'CLONE_TIMEOUT'
  | 'REPOSITORY_TOO_LARGE'
  | 'WORKSPACE_FAILED';

/** Why a repository could not be turned into a local working directory (recorded as the stage reason). */
export class RepositoryFetchError extends Error {
  readonly code: RepositoryFetchErrorCode;

  constructor(code: RepositoryFetchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RepositoryFetchError';
    this.code = code;
  }
}
