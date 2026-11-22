/**
 * Phase 8 recommended actions:
 * - `UPGRADE_DIRECT`: change the version declared in pom.xml.
 * - `OVERRIDE_TRANSITIVE`: pin the version via <dependencyManagement> (or upgrade the dependency
 *   that pulls it in — which of its versions fixes it is not known statically).
 * - `NO_FIX`: some findings have no published fixed version.
 * - `REVIEW_UNUSED`: a direct dependency with no main-source usage — check runtime/reflective use,
 *   then consider removing it.
 */
export type RemediationActionKind = 'UPGRADE_DIRECT' | 'OVERRIDE_TRANSITIVE' | 'NO_FIX' | 'REVIEW_UNUSED';

export interface RemediationAction {
  kind: RemediationActionKind;
  description: string;
}

/**
 * What the recommended version does for one finding:
 * - `FIXED`: the version is outside every affected range.
 * - `STILL_AFFECTED`: the finding has fixes, but not in a version below or at the recommendation.
 * - `NO_FIX`: OSV lists no fixed version.
 * - `UNKNOWN`: a version or range could not be evaluated.
 */
export type FixStatus = 'FIXED' | 'STILL_AFFECTED' | 'NO_FIX' | 'UNKNOWN';

export interface FindingFixStatus {
  /** Stored finding id when the plan was built from stored findings. */
  findingId?: string;
  vulnerabilityId: string;
  aliases: string[];
  severity: string;
  riskScore?: number;
  /** Fixed versions in Maven order (unparsable ones last, as given). */
  fixedVersions: string[];
  status: FixStatus;
}

/** Phase 8: one upgrade decision for one dependency, with the findings it settles (CLAUDE.md §7). */
export interface DependencyRemediation {
  dependency: {
    /** `groupId:artifactId`. */
    name: string;
    currentVersion: string;
    purl: string;
    /** undefined when the dependency was not found among the scan's dependencies. */
    direct?: boolean;
    /** Transitive only: purls that pull it in, nearest first. */
    introducedBy?: string[];
    /** File the dependency was found in (name only, e.g. `pom.xml`). */
    declaredIn?: string;
  };
  /**
   * Lowest OSV-listed fixed version above the current one that leaves no fixable finding affected
   * (or, if none does, the one that fixes the most). Absent when no finding has a usable fix.
   */
  recommendedVersion?: string;
  /** The recommendation changes the leading version number — APIs may have changed. */
  majorUpgrade: boolean;
  actions: RemediationAction[];
  /** Every finding of the dependency, highest risk first, with what the recommendation does for it. */
  findings: FindingFixStatus[];
  fixedCount: number;
  maxRiskScore?: number;
  /** `METHOD path` of endpoints that reach any of its vulnerable usages (Phase 6). */
  reachableEndpoints: string[];
  /** `file:line` of main-source usages (Phase 4). */
  affectedFiles: string[];
  /** `Class#method` containing reachable vulnerable usages (Phase 6). */
  affectedMethods: string[];
  /** How the recommendation was derived and what it does not cover. */
  basis: string;
}
