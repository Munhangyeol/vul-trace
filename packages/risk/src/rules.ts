import type { Severity } from '@vulntrace/shared';

/**
 * Phase 7 weight table — the only place scoring numbers live (CLAUDE.md §8 "never hide scoring
 * logic"). Bump `RULES_VERSION` whenever a number changes so stored scores say which table they used.
 *
 * Scores are additive and clamped to 0–100, so every point is one reason's weight.
 */
export const RULES_VERSION = '2026-11-22.1';

export const RULES = {
  /** CVSS v3 base score × this, rounded (max 40). */
  cvssMultiplier: 4,
  /** Used when there is no CVSS v3 score: points per severity label. */
  severityFallback: {
    CRITICAL: 36,
    HIGH: 28,
    MEDIUM: 18,
    LOW: 8,
    UNKNOWN: 10,
  } satisfies Record<Severity, number>,

  /** Highest usage step only (they are not cumulative). */
  usage: {
    notUsed: 0,
    used: 10,
    vulnerableApiUsed: 20,
    reachable: 35,
  },

  directDependency: 5,

  /** Only applied when the vulnerable API is reachable from an endpoint. */
  authentication: {
    notRequired: 10,
    required: -10,
    unknown: 0,
  },

  /** OSV EVIDENCE reference present (Phase 7 D5). */
  knownExploit: 10,

  /** Informational: a fix makes the finding actionable but does not change exposure. */
  fixAvailable: 0,

  /** Endpoints listed as evidence on the reachability reason. */
  maxEndpointsListed: 5,
} as const;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
