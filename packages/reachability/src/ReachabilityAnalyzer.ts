import type {
  CallPath,
  CallPathStep,
  ReachabilityResult,
  ReachabilityScope,
  SinkAttribution,
  SourceLocation,
  SourceUsage,
  SpringEndpoint,
  VulnerabilityFinding,
} from '@vulntrace/shared';
import type { JavaAnalysisResult, SourcePosition, SourceRange } from '@vulntrace/source-analyzer';
import type { CallGraph, CallGraphStats, MethodCallEdge } from './CallGraph.js';
import { callGraphStats } from './CallGraph.js';
import { CallGraphBuilder } from './CallGraphBuilder.js';

export interface ReachabilityInput {
  java: JavaAnalysisResult;
  endpoints: readonly SpringEndpoint[];
  /** Findings with Phase 4 `usage`; findings without it get no result. */
  findings: readonly VulnerabilityFinding[];
}

export interface ReachabilityOptions {
  /** Longest call chain followed from a handler, in calls. Default 30. */
  maxDepth?: number;
  /** Paths kept per finding. Default 20. */
  maxPathsPerFinding?: number;
}

export interface ReachabilityAnalysis {
  /** Index-aligned with `input.findings`; undefined where the finding has no `usage`. */
  results: (ReachabilityResult | undefined)[];
  graph: CallGraphStats;
  /** Endpoints whose handler method could not be found in the call graph. */
  warnings: string[];
}

/** Features Stage A does not follow (CLAUDE.md §5); shown with every result. */
export const UNSUPPORTED_FEATURES: readonly string[] = [
  'chained calls (a().b())',
  'reflection and dynamic proxies',
  'AOP advice, filters and interceptors',
  '@Async, @EventListener, @Scheduled and other container-invoked methods',
  'whether a lambda or method reference is actually invoked',
  'which implementation is injected when an interface has several',
];

/** One reached node during BFS: how it was reached (absent for the handler) and at which depth. */
interface Visit {
  depth: number;
  via?: MethodCallEdge;
}

/** A vulnerable usage placed on the graph. */
interface Sink {
  usage: SourceUsage;
  nodeIds: string[];
  attribution: SinkAttribution;
}

/**
 * Phase 6 — searches from every Spring endpoint handler to the methods containing vulnerable API
 * usages, and keeps the shortest call path per (endpoint, usage) pair as evidence (CLAUDE.md §6.2).
 */
export class ReachabilityAnalyzer {
  private readonly maxDepth: number;
  private readonly maxPaths: number;

  constructor(
    options: ReachabilityOptions = {},
    private readonly builder: Pick<CallGraphBuilder, 'build'> = new CallGraphBuilder(),
  ) {
    this.maxDepth = options.maxDepth ?? 30;
    this.maxPaths = options.maxPathsPerFinding ?? 20;
  }

  analyze(input: ReachabilityInput): ReachabilityAnalysis {
    const graph = this.builder.build(input.java);
    const warnings: string[] = [];

    // One BFS per endpoint, shared by every finding.
    const searches: { endpoint: SpringEndpoint; handlerId: string; visits: Map<string, Visit> }[] = [];
    for (const endpoint of input.endpoints) {
      const handlerId = findHandler(graph, endpoint);
      if (!handlerId) {
        warnings.push(
          `handler ${endpoint.controllerClass}#${endpoint.controllerMethod} for ${endpoint.httpMethod} ${endpoint.path} not found in the call graph`,
        );
        continue;
      }
      searches.push({ endpoint, handlerId, visits: this.search(graph, handlerId) });
    }

    const visited = new Set<string>();
    for (const s of searches) for (const id of s.visits.keys()) visited.add(id);
    let unresolvedCallCount = 0;
    for (const id of visited) unresolvedCallCount += graph.unresolved.get(id)?.length ?? 0;
    const scope: ReachabilityScope = {
      endpointCount: input.endpoints.length,
      visitedMethodCount: visited.size,
      unresolvedCallCount,
      unsupported: [...UNSUPPORTED_FEATURES],
    };

    const results = input.findings.map((finding): ReachabilityResult | undefined => {
      const usage = finding.usage;
      if (!usage) return undefined;
      const base = { paths: [], totalPaths: 0, truncated: false, scope };
      if (usage.vulnerableApi === 'NO_API_INFO') {
        return { ...base, status: 'NO_API_INFO', reachable: false, reason: 'no vulnerable API information' };
      }
      if (usage.vulnerableApi === 'NOT_DETECTED') {
        return {
          ...base,
          status: 'NO_VULNERABLE_API_USAGE',
          reachable: false,
          reason: 'no vulnerable API usage in main source',
        };
      }

      const sinks = usage.usages
        .filter((u) => u.vulnerableApi && u.sourceSet === 'MAIN' && u.kind !== 'IMPORT')
        .map((u) => locateSink(graph, u))
        .filter((s): s is Sink => s !== undefined);
      if (sinks.length === 0) {
        return { ...base, status: 'NOT_REACHABLE', reachable: false, reason: 'vulnerable API usage is outside any method' };
      }
      if (input.endpoints.length === 0) {
        return { ...base, status: 'NOT_REACHABLE', reachable: false, reason: 'no endpoints' };
      }

      const paths: CallPath[] = [];
      for (const search of searches) {
        for (const sink of sinks) {
          const path = this.shortestPath(graph, search, sink);
          if (path) paths.push(path);
        }
      }
      if (paths.length === 0) {
        return { ...base, status: 'NOT_REACHABLE', reachable: false, reason: 'no call path from any endpoint' };
      }
      paths.sort(comparePaths);
      return {
        status: 'REACHABLE',
        reachable: true,
        paths: paths.slice(0, this.maxPaths),
        totalPaths: paths.length,
        truncated: paths.length > this.maxPaths,
        scope,
      };
    });

    return { results, graph: callGraphStats(graph), warnings };
  }

  private search(graph: CallGraph, handlerId: string): Map<string, Visit> {
    const visits = new Map<string, Visit>([[handlerId, { depth: 0 }]]);
    const queue = [handlerId];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head] as string;
      const depth = (visits.get(id) as Visit).depth;
      if (depth >= this.maxDepth) continue;
      for (const edge of graph.edges.get(id) ?? []) {
        if (visits.has(edge.calleeId)) continue;
        visits.set(edge.calleeId, { depth: depth + 1, via: edge });
        queue.push(edge.calleeId);
      }
    }
    return visits;
  }

  private shortestPath(
    graph: CallGraph,
    search: { endpoint: SpringEndpoint; handlerId: string; visits: Map<string, Visit> },
    sink: Sink,
  ): CallPath | undefined {
    let best: string | undefined;
    for (const id of sink.nodeIds) {
      const visit = search.visits.get(id);
      if (visit && (best === undefined || visit.depth < (search.visits.get(best) as Visit).depth)) best = id;
    }
    if (best === undefined) return undefined;

    // Walk back from the sink's method to the handler.
    const chain: { id: string; via?: MethodCallEdge }[] = [];
    for (let id: string | undefined = best; id !== undefined; ) {
      const visit: Visit = search.visits.get(id) as Visit;
      chain.unshift({ id, ...(visit.via ? { via: visit.via } : {}) });
      id = visit.via?.callerId;
    }
    const steps: CallPathStep[] = chain.map((link, i) => {
      const node = graph.nodes.get(link.id);
      const next = chain[i + 1]?.via;
      const callSite: SourceLocation = next ? next.callSite : sink.usage.evidence.location;
      const callSnippet = next ? next.snippet : sink.usage.evidence.snippet.trim();
      return {
        method: node ? node.method : { className: link.id, methodName: '?' },
        callSite,
        callSnippet,
        ...(link.via ? { basis: link.via.basis } : {}),
      };
    });
    return { endpoint: search.endpoint, steps, usage: sink.usage, sinkAttribution: sink.attribution };
  }
}

function findHandler(graph: CallGraph, endpoint: SpringEndpoint): string | undefined {
  for (const node of graph.nodes.values()) {
    const loc = node.method.location;
    if (
      node.method.className === endpoint.controllerClass &&
      node.method.methodName === endpoint.controllerMethod &&
      loc?.filePath === endpoint.location.filePath &&
      loc.line === endpoint.location.line
    ) {
      return node.id;
    }
  }
  return undefined;
}

/** The innermost method containing the usage, else the initializers of the innermost class. */
function locateSink(graph: CallGraph, usage: SourceUsage): Sink | undefined {
  const at: SourcePosition = { line: usage.evidence.location.line, column: usage.evidence.location.column ?? 1 };
  const filePath = usage.evidence.location.filePath;
  let best: { id: string; range: SourceRange } | undefined;
  for (const node of graph.nodes.values()) {
    if (node.filePath !== filePath || !node.range || !contains(node.range, at)) continue;
    if (!best || isAfter(node.range.start, best.range.start)) best = { id: node.id, range: node.range };
  }
  if (best) return { usage, nodeIds: [best.id], attribution: 'METHOD' };

  // Member-level code (field initializer, initializer block): runs in the innermost class's constructors.
  let owner: { className: string; range: SourceRange } | undefined;
  for (const [className, type] of graph.types) {
    if (type.filePath !== filePath || !contains(type.range, at)) continue;
    if (!owner || isAfter(type.range.start, owner.range.start)) owner = { className, range: type.range };
  }
  const ids = owner ? (graph.initializerNodes.get(owner.className) ?? []) : [];
  return ids.length > 0 ? { usage, nodeIds: [...ids], attribution: 'INITIALIZER' } : undefined;
}

function contains(range: SourceRange, at: SourcePosition): boolean {
  return !isAfter(range.start, at) && !isAfter(at, range.end);
}

/** True when `a` comes strictly after `b`. */
function isAfter(a: SourcePosition, b: SourcePosition): boolean {
  return a.line > b.line || (a.line === b.line && a.column > b.column);
}

function comparePaths(a: CallPath, b: CallPath): number {
  return (
    a.steps.length - b.steps.length ||
    a.endpoint.path.localeCompare(b.endpoint.path) ||
    a.endpoint.httpMethod.localeCompare(b.endpoint.httpMethod) ||
    a.usage.evidence.location.filePath.localeCompare(b.usage.evidence.location.filePath) ||
    a.usage.evidence.location.line - b.usage.evidence.location.line
  );
}
