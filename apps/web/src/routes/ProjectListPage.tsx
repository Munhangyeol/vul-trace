import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateProject, useProjects } from '../api/queries';
import type { CreateProjectInput } from '../api/queries';
import { formatDate } from '../format/date';
import { formatProjectSource } from '../format/source';

type SourceType = CreateProjectInput['sourceType'];

export function ProjectListPage() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('LOCAL');
  const [path, setPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedRef = ref.trim();
    const input: CreateProjectInput =
      sourceType === 'GIT'
        ? { name, sourceType, repoUrl: repoUrl.trim(), ...(trimmedRef ? { ref: trimmedRef } : {}) }
        : { name, sourceType, path };
    createProject.mutate(input, {
      onSuccess: () => {
        setName('');
        setPath('');
        setRepoUrl('');
        setRef('');
      },
    });
  }

  return (
    <section>
      <h1>Projects</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Source
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)}>
            <option value="LOCAL">Local path</option>
            <option value="GIT">GitHub URL</option>
          </select>
        </label>
        {sourceType === 'LOCAL' ? (
          <label>
            Path
            <input value={path} onChange={(e) => setPath(e.target.value)} required />
          </label>
        ) : (
          <>
            <label>
              Repository URL
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                required
              />
            </label>
            <label>
              Branch / tag (optional)
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="default branch"
              />
            </label>
          </>
        )}
        <button type="submit" disabled={createProject.isPending}>
          {createProject.isPending ? 'Registering…' : 'Register project'}
        </button>
      </form>
      {createProject.isError && (
        <p role="alert">
          {createProject.error instanceof ApiError
            ? `${createProject.error.code}: ${createProject.error.message}`
            : 'Failed to register project.'}
        </p>
      )}

      {error && <p role="alert">Failed to load projects.</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Last Scan</th>
              <th className="num">Dependency Count</th>
              <th className="num">Vulnerability Count</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4}>Loading…</td>
              </tr>
            )}
            {!isLoading && (projects?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={4}>No projects yet.</td>
              </tr>
            )}
            {projects?.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link to={`/projects/${project.id}`}>{project.name}</Link>
                  <div className="muted">{formatProjectSource(project)}</div>
                </td>
                <td>
                  {project.latestScan ? (
                    <>
                      <span className="badge">{project.latestScan.state}</span>{' '}
                      <span className="muted">{formatDate(project.latestScan.finishedAt)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{project.latestScan?.dependencyCount ?? '—'}</td>
                <td className="num">{project.latestScan?.vulnerabilityCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
