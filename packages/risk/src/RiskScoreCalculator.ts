import type {
  ReachabilityResult,
  RiskScore,
  SourceUsage,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import { NotImplementedError } from '@vulntrace/shared';

export interface RiskInput {
  finding: VulnerabilityFinding;
  direct: boolean;
  usages: SourceUsage[];
  reachability: ReachabilityResult;
}

/** Phase 7 — pure, explainable scoring. Every point must map to a RiskReason. */
export class RiskScoreCalculator {
  calculate(_input: RiskInput): RiskScore {
    throw new NotImplementedError('RiskScoreCalculator');
  }
}
