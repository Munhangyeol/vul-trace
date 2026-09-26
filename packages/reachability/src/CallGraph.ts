import type { MethodRef, SourceLocation } from '@vulntrace/shared';

export interface MethodNode {
  id: string;
  method: MethodRef;
}

export interface MethodCallEdge {
  callerId: string;
  calleeId: string;
  callSite: SourceLocation;
}

export interface CallGraph {
  nodes: MethodNode[];
  edges: MethodCallEdge[];
}
