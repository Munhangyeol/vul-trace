import type { VulnerabilityFinding } from '@vulntrace/shared';
import { describe, expect, it } from 'vitest';
import { compareFindings } from './findingOrder.js';

const finding = (name: string, severity: VulnerabilityFinding['vulnerability']['severity'], score?: number): VulnerabilityFinding => ({
  vulnerability: {
    id: name,
    aliases: [],
    summary: '',
    severity,
    severitySource: 'DATABASE_SPECIFIC',
    modified: '2024-01-01T00:00:00Z',
    references: [],
  },
  package: { ecosystem: 'Maven', name, version: '1', purl: `pkg:maven/g/${name}@1` },
  fixedVersions: [],
  evidence: { provider: 'OSV', queriedAt: '2024-01-01T00:00:00Z', affectedRanges: [], affectedVersions: [] },
  ...(score !== undefined ? { risk: { score, reasons: [], rulesVersion: 'test' } } : {}),
});

describe('compareFindings', () => {
  it('puts the highest risk score first, then unscored findings by severity', () => {
    const findings = [
      finding('unused-critical', 'CRITICAL', 44),
      finding('reachable-medium', 'MEDIUM', 66),
      finding('unscored-high', 'HIGH'),
      finding('unscored-critical', 'CRITICAL'),
    ];
    expect([...findings].sort(compareFindings).map((f) => f.package.name)).toEqual([
      'reachable-medium',
      'unused-critical',
      'unscored-critical',
      'unscored-high',
    ]);
  });

  it('falls back to severity when scores tie', () => {
    const findings = [finding('b-high', 'HIGH', 50), finding('a-critical', 'CRITICAL', 50)];
    expect([...findings].sort(compareFindings).map((f) => f.package.name)).toEqual(['a-critical', 'b-high']);
  });
});
