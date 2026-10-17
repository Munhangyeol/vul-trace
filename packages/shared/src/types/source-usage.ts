export interface SourceLocation {
  /** Path relative to the analyzed project root, always with forward slashes. */
  filePath: string;
  line: number;
  column?: number;
}

export type UsageKind = 'IMPORT' | 'PACKAGE_REFERENCE' | 'OBJECT_CONSTRUCTION' | 'METHOD_CALL';

/** `MAIN` = src/main/java, `TEST` = src/test/java. Only MAIN usages make a dependency "used". */
export type SourceSet = 'MAIN' | 'TEST';

export interface UsageEvidence {
  location: SourceLocation;
  snippet: string;
}

export interface SourceUsage {
  kind: UsageKind;
  /**
   * Fully qualified symbol that matched, e.g. `org.apache.commons.text.StringSubstitutor`
   * for a type or `org.apache.commons.text.StringSubstitutor#createInterpolator` for a method.
   */
  symbol: string;
  dependencyPurl: string;
  sourceSet: SourceSet;
  /** True when this usage matches a known vulnerable API of the finding it is attached to. */
  vulnerableApi: boolean;
  evidence: UsageEvidence;
}

/** How a dependency's Java packages were determined — the basis for every usage match. */
export interface PackageMapping {
  packages: string[];
  /** `CURATED` = known mapping table, `GROUP_ID` = groupId assumed to be the package prefix. */
  basis: 'CURATED' | 'GROUP_ID';
}

/** A known vulnerable API: a method on a type, or (when `method` is absent) any use of the type. */
export interface VulnerableApiRef {
  type: string;
  method?: string;
}

/**
 * `USED`: a MAIN usage matches a known vulnerable API.
 * `NOT_DETECTED`: known vulnerable APIs exist but static analysis found no call (not proof of absence).
 * `NO_API_INFO`: no vulnerable-API information is known for this vulnerability.
 */
export type VulnerableApiStatus = 'USED' | 'NOT_DETECTED' | 'NO_API_INFO';

/** Phase 4 conclusion for one finding, with the evidence it was derived from (CLAUDE.md §6.2). */
export interface FindingUsage {
  /** True when at least one MAIN source usage of the dependency was found. */
  used: boolean;
  vulnerableApi: VulnerableApiStatus;
  packageMapping: PackageMapping;
  /** Vulnerable APIs that were checked; empty when `vulnerableApi` is `NO_API_INFO`. */
  vulnerableApis: VulnerableApiRef[];
  /** MAIN and TEST usages, ordered by file and line. */
  usages: SourceUsage[];
}
