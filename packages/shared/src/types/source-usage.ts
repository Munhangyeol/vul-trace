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

/**
 * Why a dependency the source never names directly still counts as used: the code calls an API
 * artifact that this dependency implements (e.g. `log4j-api` calls run in `log4j-core`).
 */
export interface ViaApiEvidence {
  /**
   * purls from the artifact the source uses directly down to this dependency's immediate caller,
   * e.g. `[log4j-api]`, or `[slf4j-api, log4j-slf4j-impl, log4j-api]` through an SLF4J binding.
   */
  path: string[];
  /** The curated relation(s) that make the link, with the documentation they come from. */
  reason: string;
}

/** Phase 4 conclusion for one finding, with the evidence it was derived from (CLAUDE.md §6.2). */
export interface FindingUsage {
  /**
   * True when at least one MAIN source usage of the dependency was found — directly, or through
   * an API it implements (`viaApi` is then set and `usages` are that API's usages).
   */
  used: boolean;
  /** Set only when `used` comes from an implemented API rather than the dependency's own packages. */
  viaApi?: ViaApiEvidence;
  vulnerableApi: VulnerableApiStatus;
  packageMapping: PackageMapping;
  /** Vulnerable APIs that were checked; empty when `vulnerableApi` is `NO_API_INFO`. */
  vulnerableApis: VulnerableApiRef[];
  /** MAIN and TEST usages, ordered by file and line. */
  usages: SourceUsage[];
}
