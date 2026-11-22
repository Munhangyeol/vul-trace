import { describe, expect, it } from 'vitest';
import { formatRiskScore, formatRiskWeight, riskBand } from './risk';

describe('risk formatting', () => {
  it('shows a dash when not scored and signed weights otherwise', () => {
    expect(formatRiskScore(null)).toBe('—');
    expect(formatRiskScore({ score: 89, reasons: [], rulesVersion: 'r' })).toBe('89');
    const reason = { factor: 'REACHABLE', status: 'APPLIED', weight: 35, description: '' } as const;
    expect(formatRiskWeight(reason)).toBe('+35');
    expect(formatRiskWeight({ ...reason, weight: -10 })).toBe('-10');
    expect(formatRiskWeight({ ...reason, weight: 0 })).toBe('0');
    expect(formatRiskWeight({ ...reason, status: 'NOT_ANALYZED', weight: 0 })).toBe('?');
  });

  it('bands scores for colour only', () => {
    expect([riskBand(89), riskBand(64), riskBand(39)]).toEqual(['high', 'medium', 'low']);
  });
});
