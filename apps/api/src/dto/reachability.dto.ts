import type {
  CallPath,
  CallPathStepDto,
  FindingReachabilityDto,
  FindingReachabilitySummaryDto,
  ReachabilityPathDto,
  ReachabilityResult,
} from '@vulntrace/shared';
import type { StoredFinding } from '@vulntrace/core';
import { toSpringEndpointDto } from './endpoint.dto.js';
import { toSourceUsageDto } from './usage.dto.js';

export type { FindingReachabilityDto, FindingReachabilitySummaryDto, ReachabilityPathDto };

export function toFindingReachabilitySummaryDto(
  reachability: ReachabilityResult | undefined,
): FindingReachabilitySummaryDto | null {
  if (!reachability) return null;
  return {
    status: reachability.status,
    reachable: reachability.reachable,
    pathCount: reachability.totalPaths,
    truncated: reachability.truncated,
    ...(reachability.reason ? { reason: reachability.reason } : {}),
    scope: reachability.scope,
  };
}

function toPathDto(path: CallPath): ReachabilityPathDto {
  return {
    endpoint: toSpringEndpointDto(path.endpoint),
    steps: path.steps.map(
      (step): CallPathStepDto => ({
        className: step.method.className,
        methodName: step.method.methodName,
        ...(step.method.location
          ? { filePath: step.method.location.filePath, line: step.method.location.line }
          : {}),
        ...(step.callSite ? { callSite: step.callSite } : {}),
        ...(step.callSnippet !== undefined ? { callSnippet: step.callSnippet } : {}),
        ...(step.basis ? { basis: step.basis } : {}),
      }),
    ),
    usage: toSourceUsageDto(path.usage),
    sinkAttribution: path.sinkAttribution,
  };
}

export function toFindingReachabilityDto(stored: StoredFinding): FindingReachabilityDto {
  const reachability = stored.finding.reachability;
  return {
    findingId: stored.id,
    analyzed: reachability !== undefined,
    summary: toFindingReachabilitySummaryDto(reachability),
    paths: (reachability?.paths ?? []).map(toPathDto),
  };
}
