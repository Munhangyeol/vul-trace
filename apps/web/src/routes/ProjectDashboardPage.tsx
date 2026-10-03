import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useProjectSummary, useRunScan } from '../api/queries';
import { formatDate } from '../format/date';

const NOT_ANALYZED_TITLE = 'Not analyzed yet — see CLAUDE.md Phase 4 (used) / Phase 6 (reachable)';

export function ProjectDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: summary, isLoading, error } = useProjectSummary(projectId ?? '');
  const runScan = useRunScan(projectId ?? '');

  if (!projectId) return <p role="alert">Missing project id.</p>;
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p role="alert">Failed to load project summary.</p>;
  if (!summary) return null;

  const scan = summary.latestScan;

  return (
    <section>
      <h1>{summary.project.name}</h1>

      <button type="button" disabled={runScan.isPending} onClick={() => runScan.mutate({})}>
        {runScan.isPending ? 'Scanning…' : 'Run scan'}
      </button>
      {runScan.isError && (
        <p role="alert">
          {runScan.error instanceof ApiError
            ? `${runScan.error.code}: ${runScan.error.message}`
            : 'Scan failed.'}
        </p>
      )}

      <dl>
        <div>
          <dt>Dependencies</dt>
          <dd>{scan ? scan.dependencies : '—'}</dd>
        </div>
        <div>
          <dt>Vulnerabilities</dt>
          <dd>{scan ? scan.vulnerabilities : '—'}</dd>
        </div>
        <div>
          <dt>Critical</dt>
          <dd>{scan ? scan.bySeverity.CRITICAL : '—'}</dd>
        </div>
        <div>
          <dt>High</dt>
          <dd>{scan ? scan.bySeverity.HIGH : '—'}</dd>
        </div>
        <div>
          <dt>Used Vulnerabilities</dt>
          <dd title={NOT_ANALYZED_TITLE}>—</dd>
        </div>
        <div>
          <dt>Reachable Vulnerabilities</dt>
          <dd title={NOT_ANALYZED_TITLE}>—</dd>
        </div>
      </dl>

      {!scan && <p>This project has not been scanned yet.</p>}

      {scan && (
        <>
          <h2>Latest scan</h2>
          <p>
            State: <strong>{scan.state}</strong> · Finished: {formatDate(scan.finishedAt)}
          </p>
          {(scan.state === 'PARTIAL' || scan.state === 'FAILED') && (
            <p role="alert">
              Scan {scan.state.toLowerCase()} — see stage statuses below for the reason.
            </p>
          )}

          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {scan.stages.map((stage) => (
                <tr key={stage.stage}>
                  <td>{stage.stage}</td>
                  <td>{stage.status}</td>
                  <td>{stage.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            Vulnerability coverage: checked {scan.coverage.checked}, not checked{' '}
            {scan.coverage.notChecked}, failed {scan.coverage.failed}
          </p>

          {scan.unresolvedDependencies.length > 0 && (
            <>
              <h3>Unresolved dependencies ({scan.unresolvedDependencies.length})</h3>
              <ul>
                {scan.unresolvedDependencies.map((dep) => (
                  <li key={`${dep.groupId}:${dep.artifactId}`}>
                    {dep.groupId}:{dep.artifactId}
                    {dep.rawVersion ? `@${dep.rawVersion}` : ''} — {dep.reason}
                  </li>
                ))}
              </ul>
            </>
          )}

          <Link to={`/projects/${projectId}/vulnerabilities`}>Vulnerabilities</Link>
        </>
      )}
    </section>
  );
}
