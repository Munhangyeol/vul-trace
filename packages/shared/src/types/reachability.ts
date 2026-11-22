import type { SourceLocation, SourceUsage } from './source-usage.js';
import type { SpringEndpoint } from './spring.js';

export interface MethodRef {
  /** Fully qualified, nested types joined with `.` (e.g. `com.example.Outer.Inner`). */
  className: string;
  methodName: string;
  /** Declaration of the method. */
  location?: SourceLocation;
}

/**
 * Why a call site was linked to a callee (Phase 6, Stage A):
 * - `DIRECT`: the receiver's declared type (or the enclosing class) declares exactly one method of
 *   that name and argument count.
 * - `INTERFACE_DISPATCH`: the receiver is a project interface / abstract class and the callee is one
 *   of its project implementations — at run time only the injected one is called.
 * - `AMBIGUOUS_OVERLOAD`: several overloads share the name and argument count; all are linked.
 */
export type CallEdgeBasis = 'DIRECT' | 'INTERFACE_DISPATCH' | 'AMBIGUOUS_OVERLOAD';

export interface CallPathStep {
  method: MethodRef;
  /** Where the next step (or, on the last step, the vulnerable usage) is invoked from inside this method. */
  callSite?: SourceLocation;
  /** The source line of `callSite`, trimmed. */
  callSnippet?: string;
  /** How the call from the previous step reached this method; absent on the first step (the handler). */
  basis?: CallEdgeBasis;
}

/**
 * `METHOD`: the usage is inside the last step's method body.
 * `INITIALIZER`: the usage is in a field initializer / initializer block, attributed to the class's
 * constructors (or to a class-level node when it has none).
 */
export type SinkAttribution = 'METHOD' | 'INITIALIZER';

/** Endpoint → ... → vulnerable usage, preserved as evidence (CLAUDE.md §6.2). */
export interface CallPath {
  endpoint: SpringEndpoint;
  steps: CallPathStep[];
  usage: SourceUsage;
  sinkAttribution: SinkAttribution;
}

/**
 * - `REACHABLE`: at least one call path from an endpoint handler to a vulnerable API usage.
 * - `NOT_REACHABLE`: vulnerable API usages exist but no path was found. Not proof of absence — see
 *   `scope` for what Stage A could not follow.
 * - `NO_VULNERABLE_API_USAGE`: known vulnerable APIs exist but none is used in MAIN source.
 * - `NO_API_INFO`: no vulnerable-API information is known for this vulnerability.
 */
export type ReachabilityStatus = 'REACHABLE' | 'NOT_REACHABLE' | 'NO_VULNERABLE_API_USAGE' | 'NO_API_INFO';

/** What the search could and could not see, so `NOT_REACHABLE` is never over-trusted. */
export interface ReachabilityScope {
  /** Endpoints the search started from. */
  endpointCount: number;
  /** Project methods reachable from any endpoint. */
  visitedMethodCount: number;
  /**
   * Calls inside visited methods whose target could not be determined (chained receivers, unknown
   * receiver types) and that share a name with some project method, so could have reached project
   * code. Calls into library types, and calls no project method could answer, are not counted.
   */
  unresolvedCallCount: number;
  /** Fixed list of Java / Spring features Stage A does not follow. */
  unsupported: string[];
}

export interface ReachabilityResult {
  status: ReachabilityStatus;
  /** `status === 'REACHABLE'`. */
  reachable: boolean;
  /** Why it is reachable: shortest path per (endpoint, usage) pair. Empty when not reachable. */
  paths: CallPath[];
  /** Paths found before the cap; larger than `paths.length` when `truncated`. */
  totalPaths: number;
  truncated: boolean;
  /** Human-readable reason for non-reachable statuses, e.g. `no endpoints`. */
  reason?: string;
  scope: ReachabilityScope;
}
