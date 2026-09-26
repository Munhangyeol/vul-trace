import type { ReachabilityResult, SourceUsage, SpringEndpoint } from '@vulntrace/shared';
import { NotImplementedError } from '@vulntrace/shared';
import type { CallGraph } from './CallGraph.js';

export interface ReachabilityInput {
  graph: CallGraph;
  endpoints: SpringEndpoint[];
  usage: SourceUsage;
}

/** Phase 6 — endpoint → ... → usage path search, preserving every path found. */
export class ReachabilityAnalyzer {
  analyze(_input: ReachabilityInput): ReachabilityResult {
    throw new NotImplementedError('ReachabilityAnalyzer');
  }
}
