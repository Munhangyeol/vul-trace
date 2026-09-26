export interface SourceLocation {
  /** Path relative to the analyzed project root. */
  filePath: string;
  line: number;
  column?: number;
}

export type UsageKind = 'IMPORT' | 'PACKAGE_REFERENCE' | 'OBJECT_CONSTRUCTION' | 'METHOD_CALL';

export interface UsageEvidence {
  location: SourceLocation;
  snippet: string;
}

export interface SourceUsage {
  kind: UsageKind;
  /** Fully qualified symbol that matched, e.g. org.apache.commons.text.StringSubstitutor */
  symbol: string;
  dependencyPurl: string;
  evidence: UsageEvidence;
}
