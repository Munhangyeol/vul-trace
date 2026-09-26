import { Link, useParams } from 'react-router';

const METRICS = [
  'Dependencies',
  'Vulnerabilities',
  'Critical',
  'High',
  'Used Vulnerabilities',
  'Reachable Vulnerabilities',
] as const;

export function ProjectDashboardPage() {
  const { projectId } = useParams();

  return (
    <section>
      <h1>Project {projectId}</h1>
      <dl>
        {METRICS.map((metric) => (
          <div key={metric}>
            <dt>{metric}</dt>
            <dd>—</dd>
          </div>
        ))}
      </dl>
      <Link to={`/projects/${projectId}/vulnerabilities`}>Vulnerabilities</Link>
    </section>
  );
}
