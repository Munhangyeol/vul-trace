import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateProject, useProjects } from '../api/queries';
import { formatDate } from '../format/date';

export function ProjectListPage() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createProject.mutate(
      { name, path },
      {
        onSuccess: () => {
          setName('');
          setPath('');
        },
      },
    );
  }

  return (
    <section>
      <h1>Projects</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Path
          <input value={path} onChange={(e) => setPath(e.target.value)} required />
        </label>
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

      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Last Scan</th>
            <th>Dependency Count</th>
            <th>Vulnerability Count</th>
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
              </td>
              <td>
                {project.latestScan
                  ? `${project.latestScan.state} (${formatDate(project.latestScan.finishedAt)})`
                  : '—'}
              </td>
              <td>{project.latestScan?.dependencyCount ?? '—'}</td>
              <td>{project.latestScan?.vulnerabilityCount ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
