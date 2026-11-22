import { Link } from 'react-router';
import type { DependencyRemediationDto } from '@vulntrace/shared';
import { formatActionKind, formatFixStatus, formatUpgrade } from '../format/remediation';
import { riskBand } from '../format/risk';

/** Phase 8: one dependency's upgrade decision with the evidence behind it (CLAUDE.md §7). */
export function RemediationCard({ plan, highlightFindingId }: { plan: DependencyRemediationDto; highlightFindingId?: string }) {
  const { dependency } = plan;
  return (
    <div className="remediation">
      <h3>
        {dependency.name} <span className="upgrade">{formatUpgrade(dependency.currentVersion, plan.recommendedVersion)}</span>
        {plan.majorUpgrade && <span className="badge sev-high">Major upgrade</span>}
      </h3>
      <p className="muted">
        {dependency.direct === undefined
          ? 'Dependency source unknown'
          : dependency.direct
            ? `Direct dependency (${dependency.declaredIn ?? 'pom.xml'})`
            : `Transitive${dependency.introducedBy?.length ? ` via ${dependency.introducedBy.join(' → ')}` : ''}`}
        {' · '}fixes {plan.fixedCount} of {plan.findings.length}
        {plan.maxRiskScore !== undefined && (
          <>
            {' · highest risk '}
            <span className={`badge risk-${riskBand(plan.maxRiskScore)}`}>{plan.maxRiskScore}</span>
          </>
        )}
      </p>
      <ul className="actions">
        {plan.actions.map((action) => (
          <li key={action.kind}>
            <strong>{formatActionKind(action.kind)}</strong>: {action.description}
          </li>
        ))}
      </ul>
      <dl>
        {plan.reachableEndpoints.length > 0 && (
          <div>
            <dt>Reachable endpoints</dt>
            <dd>{plan.reachableEndpoints.join(', ')}</dd>
          </div>
        )}
        {plan.affectedMethods.length > 0 && (
          <div>
            <dt>Affected methods</dt>
            <dd>{plan.affectedMethods.join(', ')}</dd>
          </div>
        )}
        {plan.affectedFiles.length > 0 && (
          <div>
            <dt>Affected files</dt>
            <dd>{plan.affectedFiles.join(', ')}</dd>
          </div>
        )}
      </dl>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CVE</th>
              <th className="num">Risk</th>
              <th>At {plan.recommendedVersion ?? 'recommended version'}</th>
              <th>Fixed versions (OSV)</th>
            </tr>
          </thead>
          <tbody>
            {plan.findings.map((f) => (
              <tr key={f.vulnerabilityId} className={f.findingId === highlightFindingId ? 'highlight' : undefined}>
                <td>{f.findingId ? <Link to={`/findings/${f.findingId}`}>{f.displayId}</Link> : f.displayId}</td>
                <td className="num">{f.riskScore ?? '—'}</td>
                <td>{formatFixStatus(f.status)}</td>
                <td>{f.fixedVersions.length > 0 ? f.fixedVersions.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
