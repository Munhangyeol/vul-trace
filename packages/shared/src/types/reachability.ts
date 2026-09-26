import type { SourceLocation, SourceUsage } from './source-usage.js';
import type { SpringEndpoint } from './spring.js';

export interface MethodRef {
  className: string;
  methodName: string;
  location?: SourceLocation;
}

export interface CallPathStep {
  method: MethodRef;
  /** Where the next step is invoked from inside this method. */
  callSite?: SourceLocation;
}

/** Endpoint → ... → vulnerable usage, preserved as evidence (CLAUDE.md §6.2). */
export interface CallPath {
  endpoint: SpringEndpoint;
  steps: CallPathStep[];
  usage: SourceUsage;
}

export interface ReachabilityResult {
  reachable: boolean;
  /** Why it is reachable. Empty when reachable is false. */
  paths: CallPath[];
}
