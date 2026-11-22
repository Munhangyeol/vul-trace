import type { CallEdgeBasis, MethodRef, SourceLocation } from '@vulntrace/shared';
import type { SourceRange } from '@vulntrace/source-analyzer';

export interface MethodNode {
  /** `<qualified class>#<method index>`, or `<qualified class>#<init>` for an implicit constructor. */
  id: string;
  method: MethodRef;
  filePath: string;
  /** Absent for implicit constructors, which have no source. */
  range?: SourceRange;
  /** True for a constructor the class does not declare (Java's default constructor). */
  implicit: boolean;
}

export interface MethodCallEdge {
  callerId: string;
  calleeId: string;
  callSite: SourceLocation;
  /** The trimmed source line of `callSite`. */
  snippet: string;
  basis: CallEdgeBasis;
}

/** A call site in a project method whose target Stage A could not determine. */
export interface UnresolvedCall {
  callerId: string;
  location: SourceLocation;
  /** e.g. `chained receiver`, `unknown receiver 'repo'`. */
  reason: string;
}

export interface CallGraph {
  nodes: ReadonlyMap<string, MethodNode>;
  /** Outgoing edges per caller id, in source order. */
  edges: ReadonlyMap<string, readonly MethodCallEdge[]>;
  unresolved: ReadonlyMap<string, readonly UnresolvedCall[]>;
  /** Nodes that run the member-level code (field initializers, initializer blocks) of each class. */
  initializerNodes: ReadonlyMap<string, readonly string[]>;
  /** Project types by qualified name, with where they are declared. */
  types: ReadonlyMap<string, { filePath: string; range: SourceRange }>;
}

export interface CallGraphStats {
  methodCount: number;
  edgeCount: number;
  unresolvedCallCount: number;
}

export function callGraphStats(graph: CallGraph): CallGraphStats {
  let edgeCount = 0;
  for (const list of graph.edges.values()) edgeCount += list.length;
  let unresolvedCallCount = 0;
  for (const list of graph.unresolved.values()) unresolvedCallCount += list.length;
  return { methodCount: graph.nodes.size, edgeCount, unresolvedCallCount };
}
