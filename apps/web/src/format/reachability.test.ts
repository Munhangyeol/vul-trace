import { describe, expect, it } from 'vitest';
import type { FindingReachabilitySummaryDto } from '@vulntrace/shared';
import { formatCallBasis, formatReachable, formatSimpleClassName } from './reachability';

const summary = (status: FindingReachabilitySummaryDto['status']): FindingReachabilitySummaryDto => ({
  status,
  reachable: status === 'REACHABLE',
  pathCount: status === 'REACHABLE' ? 1 : 0,
  truncated: false,
  scope: { endpointCount: 1, visitedMethodCount: 1, unresolvedCallCount: 0, unsupported: [] },
});

describe('reachability formatting', () => {
  it('distinguishes not analyzed, no path found, and not used', () => {
    expect(formatReachable(null)).toBe('—');
    expect(formatReachable(summary('REACHABLE'))).toBe('Yes');
    // Stage A cannot prove absence, so a missing path is never a plain "No".
    expect(formatReachable(summary('NOT_REACHABLE'))).toBe('No path found');
    expect(formatReachable(summary('NO_VULNERABLE_API_USAGE'))).toBe('No (vulnerable API not used)');
    expect(formatReachable(summary('NO_API_INFO'))).toBe('Unknown (no vulnerable API info)');
  });

  it('labels call edges and shortens class names', () => {
    expect(formatCallBasis('INTERFACE_DISPATCH')).toContain('interface');
    expect(formatSimpleClassName('com.example.demo.TemplateService')).toBe('TemplateService');
    expect(formatSimpleClassName('Plain')).toBe('Plain');
  });
});
