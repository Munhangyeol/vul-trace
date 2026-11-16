import { Link, useParams } from 'react-router';
import { useEndpoints } from '../api/queries';

const COLUMNS = ['Method', 'Path', 'Controller', 'Handler', 'Source', 'Mapping'] as const;

/** Phase 5: Spring MVC entry points of the latest scan, with the annotations they came from. */
export function EndpointListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, isLoading, error } = useEndpoints(projectId ?? '');

  if (!projectId) return <p role="alert">Missing project id.</p>;

  return (
    <section>
      <Link to={`/projects/${projectId}`} className="breadcrumb">
        ← Project dashboard
      </Link>
      <h1>Spring endpoints</h1>
      {error && <p role="alert">Failed to load endpoints.</p>}
      {data && !data.analyzed && (
        <p className="muted">
          {data.scanId === null
            ? 'This project has not been scanned yet.'
            : `Endpoints were not analyzed in the latest scan${
                data.stage ? ` (${data.stage.status}${data.stage.reason ? ` — ${data.stage.reason}` : ''})` : ''
              }.`}
        </p>
      )}
      {data?.analyzed && <p className="muted">{data.endpoints.length} endpoints in the latest scan</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={COLUMNS.length}>Loading…</td>
              </tr>
            )}
            {data?.analyzed && data.endpoints.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length}>No Spring endpoints found.</td>
              </tr>
            )}
            {data?.endpoints.map((endpoint) => (
              <tr key={`${endpoint.httpMethod} ${endpoint.path} ${endpoint.filePath}:${endpoint.line}`}>
                <td>
                  <span className="badge">{endpoint.httpMethod}</span>
                </td>
                <td>
                  <code>{endpoint.path}</code>
                  {endpoint.unresolved.length > 0 && (
                    <div className="muted" title="Not a string literal — not evaluated statically">
                      unresolved: {endpoint.unresolved.join(', ')}
                    </div>
                  )}
                </td>
                <td>{endpoint.controllerClass}</td>
                <td>{endpoint.controllerMethod}</td>
                <td>
                  <code>
                    {endpoint.filePath}:{endpoint.line}
                  </code>
                </td>
                <td>
                  {endpoint.evidence.classMapping && (
                    <div>
                      <code>{endpoint.evidence.classMapping.annotation}</code>
                    </div>
                  )}
                  <code>{endpoint.evidence.methodMapping.annotation}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
