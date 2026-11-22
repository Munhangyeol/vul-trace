import type { CallEdgeBasis, FindingReachabilitySummaryDto, ReachabilityStatus } from '@vulntrace/shared';

const STATUS_LABEL: Record<ReachabilityStatus, string> = {
  REACHABLE: 'Yes',
  NOT_REACHABLE: 'No path found',
  NO_VULNERABLE_API_USAGE: 'No (vulnerable API not used)',
  NO_API_INFO: 'Unknown (no vulnerable API info)',
};

/** '—' when reachability was not analyzed (null ≠ false); NOT_REACHABLE is never shown as a plain "No". */
export function formatReachable(reachability: FindingReachabilitySummaryDto | null): string {
  return reachability ? STATUS_LABEL[reachability.status] : '—';
}

const BASIS_LABEL: Record<CallEdgeBasis, string> = {
  DIRECT: 'direct call',
  INTERFACE_DISPATCH: 'via interface — one of several possible implementations',
  AMBIGUOUS_OVERLOAD: 'one of several overloads with the same argument count',
};

export function formatCallBasis(basis: CallEdgeBasis): string {
  return BASIS_LABEL[basis];
}

/** `com.example.demo.TemplateService` → `TemplateService` for compact path display. */
export function formatSimpleClassName(className: string): string {
  const lastDot = className.lastIndexOf('.');
  return lastDot < 0 ? className : className.slice(lastDot + 1);
}
