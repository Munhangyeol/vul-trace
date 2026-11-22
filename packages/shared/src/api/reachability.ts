import type {
  CallEdgeBasis,
  ReachabilityScope,
  ReachabilityStatus,
  SinkAttribution,
} from '../types/reachability.js';
import type { SpringEndpointDto } from './endpoint.js';
import type { SourceUsageDto } from './usage.js';

/** Phase 6 conclusion for a finding, without the paths (see `FindingReachabilityDto`). */
export interface FindingReachabilitySummaryDto {
  status: ReachabilityStatus;
  reachable: boolean;
  /** Paths found (may exceed the paths returned when `truncated`). */
  pathCount: number;
  truncated: boolean;
  reason?: string;
  scope: ReachabilityScope;
}

export interface CallPathStepDto {
  className: string;
  methodName: string;
  /** Method declaration; absent for an implicit constructor. */
  filePath?: string;
  line?: number;
  /** Where this method calls the next step (or the vulnerable API on the last step). */
  callSite?: { filePath: string; line: number; column?: number };
  callSnippet?: string;
  /** How the previous step's call reached this method; absent on the first step. */
  basis?: CallEdgeBasis;
}

export interface ReachabilityPathDto {
  endpoint: SpringEndpointDto;
  steps: CallPathStepDto[];
  usage: SourceUsageDto;
  sinkAttribution: SinkAttribution;
}

/** GET /api/findings/:findingId/reachability */
export interface FindingReachabilityDto {
  findingId: string;
  /** False when reachability was not analyzed for this finding's scan — `paths` is then empty. */
  analyzed: boolean;
  summary: FindingReachabilitySummaryDto | null;
  /** Shortest first. */
  paths: ReachabilityPathDto[];
}
