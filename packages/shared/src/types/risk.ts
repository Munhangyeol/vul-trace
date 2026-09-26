export type RiskFactor =
  | 'CVSS_SEVERITY'
  | 'DIRECT_DEPENDENCY'
  | 'SOURCE_USAGE'
  | 'VULNERABLE_API_USAGE'
  | 'REACHABLE'
  | 'HTTP_EXPOSURE'
  | 'AUTHENTICATION_REQUIRED'
  | 'KNOWN_EXPLOIT'
  | 'FIX_AVAILABLE';

export interface RiskReason {
  factor: RiskFactor;
  /** Contribution to the final score; may be negative. */
  weight: number;
  description: string;
}

export interface RiskScore {
  score: number;
  reasons: RiskReason[];
}
