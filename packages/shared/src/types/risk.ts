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

/**
 * - `APPLIED`: the factor was evaluated and contributes `weight` (which may be 0 or negative).
 * - `NOT_ANALYZED`: the scan stage that feeds this factor did not run — 0 points, and unknown is
 *   not the same as "no" (CLAUDE.md §19).
 */
export type RiskReasonStatus = 'APPLIED' | 'NOT_ANALYZED';

export interface RiskReason {
  factor: RiskFactor;
  status: RiskReasonStatus;
  /** Contribution to the final score; may be negative. The weights of all reasons sum to `score`. */
  weight: number;
  description: string;
  /** Supporting facts, e.g. endpoints that reach the usage or an exploit evidence URL. */
  evidence?: string[];
}

export interface RiskScore {
  /** 0–100, the clamped sum of `reasons[].weight`. */
  score: number;
  reasons: RiskReason[];
  /** Version of the weight table the score was computed with (`packages/risk/src/rules.ts`). */
  rulesVersion: string;
}

/**
 * Whether reaching an endpoint requires authentication, as far as static analysis can tell:
 * - `REQUIRED`: the handler method or its controller carries @PreAuthorize / @Secured / @RolesAllowed.
 * - `NOT_REQUIRED`: the project has no Spring Security dependency at all.
 * - `UNKNOWN`: anything else (e.g. URL rules in a SecurityFilterChain, which Phase 7 does not read).
 */
export type AuthenticationStatus = 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';
