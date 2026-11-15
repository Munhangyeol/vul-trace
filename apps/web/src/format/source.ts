import type { ProjectDto } from '@vulntrace/shared';

/** One-line description of where a project's code comes from. */
export function formatProjectSource(project: ProjectDto): string {
  if (project.sourceType === 'GIT') {
    return `${project.repoUrl ?? ''}${project.ref ? ` (${project.ref})` : ''}`;
  }
  return project.path ?? '';
}

/** Short form for display; the full SHA stays available as the element title. */
export function formatCommitSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 12) : '—';
}
