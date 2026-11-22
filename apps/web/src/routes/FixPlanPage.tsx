import { Link, useParams } from 'react-router';
import { useRemediation } from '../api/queries';
import { RemediationCard } from './RemediationCard';

/** Phase 8: one upgrade decision per vulnerable dependency of the latest scan, highest risk first. */
export function FixPlanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, isLoading, error } = useRemediation(projectId ?? '');

  if (!projectId) return <p role="alert">Missing project id.</p>;
  const total = data?.dependencies.reduce((sum, d) => sum + d.findings.length, 0) ?? 0;

  return (
    <section>
      <Link to={`/projects/${projectId}`} className="breadcrumb">
        ← Project dashboard
      </Link>
      <h1>Fix plan</h1>
      {isLoading && <p>Loading…</p>}
      {error && <p role="alert">Failed to load the fix plan.</p>}
      {data?.scanId === null && <p className="muted">This project has not been scanned yet.</p>}
      {data && data.scanId !== null && data.dependencies.length === 0 && <p>No vulnerable dependencies in the latest scan.</p>}
      {data && data.dependencies.length > 0 && (
        <>
          <p className="muted">
            {data.dependencies.length} dependencies to change for {total} findings, highest risk first.{' '}
            {data.dependencies[0]?.basis}
          </p>
          {data.dependencies.map((plan) => (
            <section key={plan.dependency.purl} className="card">
              <RemediationCard plan={plan} />
            </section>
          ))}
        </>
      )}
    </section>
  );
}
