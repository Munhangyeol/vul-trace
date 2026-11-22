import type { FindingRiskDto, RiskReason } from '@vulntrace/shared';

/** '—' when not scored; otherwise the 0–100 score. */
export function formatRiskScore(risk: FindingRiskDto | null): string {
  return risk ? String(risk.score) : '—';
}

/** `+35`, `-10`, `0`, or `?` for a factor whose scan stage did not run (unknown, not zero). */
export function formatRiskWeight(reason: RiskReason): string {
  if (reason.status === 'NOT_ANALYZED') return '?';
  return reason.weight > 0 ? `+${reason.weight}` : String(reason.weight);
}

/** Coarse band for colouring only — the number and its reasons are the result. */
export function riskBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
