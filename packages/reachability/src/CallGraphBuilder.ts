import type { CallEdgeBasis, SourceLocation } from '@vulntrace/shared';
import type {
  AnalyzedJavaFile,
  JavaAnalysisResult,
  JavaMemberScope,
  JavaMethod,
  JavaMethodInvocation,
  JavaObjectCreation,
  SourceRange,
} from '@vulntrace/source-analyzer';
import type { CallGraph, MethodCallEdge, MethodNode, UnresolvedCall } from './CallGraph.js';
import { TypeIndex } from './TypeIndex.js';

/** What a call's receiver turned out to be. */
type Receiver =
  | { kind: 'PROJECT'; qualifiedName: string; /** `this` / unqualified: lexical lookup applies */ implicit: boolean }
  | { kind: 'EXTERNAL' }
  | { kind: 'UNKNOWN'; reason: string };

interface Target {
  nodeId: string;
  basis: CallEdgeBasis;
}

export const nodeId = (className: string, methodIndex: number | '<init>'): string => `${className}#${methodIndex}`;

/**
 * Builds the Stage A call graph over MAIN sources (CLAUDE.md §5, Phase 6):
 * nodes are project methods and constructors; edges are call sites resolved through the declared
 * types of `this`, fields, parameters and locals, static calls, and `new T(...)`. Calls on project
 * interfaces / overridable methods are linked to every project implementation (CHA).
 */
export class CallGraphBuilder {
  build(java: JavaAnalysisResult): CallGraph {
    const files = java.files.filter((f) => f.sourceSet === 'MAIN');
    const index = new TypeIndex(files);
    const nodes = new Map<string, MethodNode>();
    const edges = new Map<string, MethodCallEdge[]>();
    const unresolved = new Map<string, UnresolvedCall[]>();
    const initializerNodes = new Map<string, string[]>();
    const types = new Map<string, { filePath: string; range: SourceRange }>();

    for (const { type, file } of index.all()) {
      types.set(type.qualifiedName, { filePath: file.filePath, range: type.range });
      type.methods.forEach((method, i) => {
        nodes.set(nodeId(type.qualifiedName, i), {
          id: nodeId(type.qualifiedName, i),
          method: { className: type.qualifiedName, methodName: method.name, location: method.location },
          filePath: file.filePath,
          range: method.range,
          implicit: false,
        });
      });
      const constructors = constructorIds(type.qualifiedName, type.methods);
      if (type.kind === 'class' || type.kind === 'enum' || type.kind === 'record') {
        if (constructors.length === 0) {
          const id = nodeId(type.qualifiedName, '<init>');
          nodes.set(id, {
            id,
            method: { className: type.qualifiedName, methodName: '<init>' },
            filePath: file.filePath,
            implicit: true,
          });
          initializerNodes.set(type.qualifiedName, [id]);
        } else {
          initializerNodes.set(type.qualifiedName, constructors);
        }
      }
    }

    const resolver = new CallResolver(index);
    const addEdge = (edge: MethodCallEdge): void => {
      const list = edges.get(edge.callerId) ?? [];
      if (!list.some((e) => e.calleeId === edge.calleeId && sameLocation(e.callSite, edge.callSite))) list.push(edge);
      edges.set(edge.callerId, list);
    };
    const addUnresolved = (call: UnresolvedCall): void => {
      unresolved.set(call.callerId, [...(unresolved.get(call.callerId) ?? []), call]);
    };

    for (const file of files) {
      const callersOf = (scope: JavaMemberScope | undefined): string[] => {
        if (!scope || !index.get(scope.typeQualifiedName)) return [];
        if (scope.methodIndex !== undefined) return [nodeId(scope.typeQualifiedName, scope.methodIndex)];
        return initializerNodes.get(scope.typeQualifiedName) ?? [];
      };

      for (const invocation of file.invocations) {
        const callers = callersOf(invocation.scope);
        if (callers.length === 0) continue;
        const outcome = resolver.resolveInvocation(invocation, file);
        for (const callerId of callers) {
          if ('reason' in outcome) {
            if (outcome.reason) addUnresolved({ callerId, location: invocation.location, reason: outcome.reason });
            continue;
          }
          for (const target of outcome.targets) {
            addEdge({
              callerId,
              calleeId: target.nodeId,
              callSite: invocation.location,
              snippet: snippetAt(file, invocation.location),
              basis: target.basis,
            });
          }
        }
      }

      for (const creation of file.objectCreations) {
        const callers = callersOf(creation.scope);
        if (callers.length === 0) continue;
        const targets = resolver.resolveCreation(creation, file, initializerNodes);
        for (const callerId of callers) {
          for (const target of targets) {
            addEdge({
              callerId,
              calleeId: target.nodeId,
              callSite: creation.location,
              snippet: snippetAt(file, creation.location),
              basis: target.basis,
            });
          }
        }
      }
    }

    return { nodes, edges, unresolved, initializerNodes, types };
  }
}

/** Resolution of one call site: linked targets, or why not (empty reason = external call, not counted). */
type InvocationOutcome = { targets: Target[] } | { reason: string };

class CallResolver {
  /** Names of every non-constructor project method: a call by any other name cannot land in project code. */
  private readonly projectMethodNames = new Set<string>();

  constructor(private readonly index: TypeIndex) {
    for (const { type } of index.all()) {
      for (const method of type.methods) if (!method.isConstructor) this.projectMethodNames.add(method.name);
    }
  }

  /**
   * Unresolved calls are only reported when they could have reached project code; a call whose
   * name no project method has (e.g. `x.get(k).toString()`) is a library call whatever its receiver.
   */
  resolveInvocation(invocation: JavaMethodInvocation, file: AnalyzedJavaFile): InvocationOutcome {
    const outcome = this.resolveInvocationTargets(invocation, file);
    if ('reason' in outcome && outcome.reason && !this.projectMethodNames.has(invocation.name)) {
      return { reason: '' };
    }
    return outcome;
  }

  private resolveInvocationTargets(invocation: JavaMethodInvocation, file: AnalyzedJavaFile): InvocationOutcome {
    const scope = invocation.scope;
    if (!scope) return { reason: '' };
    if (invocation.chained) return { reason: 'chained receiver' };

    const arity = invocation.kind === 'CALL' ? invocation.argumentCount : undefined;
    const receiver = this.resolveReceiver(invocation.qualifier, scope, file, invocation.location);
    if (receiver.kind === 'EXTERNAL') return { reason: '' };
    if (receiver.kind === 'UNKNOWN') return { reason: receiver.reason };

    if (receiver.implicit) {
      // Unqualified / `this.` call: the enclosing class, then the lexically enclosing classes.
      for (const owner of enclosingTypes(receiver.qualifiedName)) {
        if (!this.index.get(owner)) continue;
        const targets = this.findTargets(owner, invocation.name, arity);
        if (targets.length > 0) return { targets };
        if (this.index.hasExternalSupertype(owner)) return { reason: '' }; // inherited from a library
      }
      if (invocation.qualifier === undefined) {
        const staticOwner = this.staticImportOwner(invocation.name, file);
        if (staticOwner === 'EXTERNAL') return { reason: '' };
        if (staticOwner) {
          const targets = this.findTargets(staticOwner, invocation.name, arity);
          if (targets.length > 0) return { targets };
        }
      }
      return { reason: `no project method '${invocation.name}'` };
    }

    const targets = this.findTargets(receiver.qualifiedName, invocation.name, arity);
    if (targets.length > 0) return { targets };
    if (this.inheritsFromExternal(receiver.qualifiedName)) return { reason: '' };
    return { reason: `no method '${invocation.name}' on ${receiver.qualifiedName}` };
  }

  resolveCreation(
    creation: JavaObjectCreation,
    file: AnalyzedJavaFile,
    initializerNodes: ReadonlyMap<string, readonly string[]>,
  ): Target[] {
    const context = creation.scope?.typeQualifiedName;
    const resolved = this.index.resolve(creation.typeName, file, context);
    if (resolved.kind !== 'PROJECT') return [];
    const ids = initializerNodes.get(resolved.qualifiedName) ?? [];
    const basis: CallEdgeBasis = ids.length > 1 ? 'AMBIGUOUS_OVERLOAD' : 'DIRECT';
    return ids.map((id) => ({ nodeId: id, basis }));
  }

  /** Methods `name` (with `arity` arguments, when known) callable on a receiver of type `owner`. */
  private findTargets(owner: string, name: string, arity: number | undefined): Target[] {
    const hierarchy = [owner, ...this.index.supertypesOf(owner)];
    let declared: { id: string; method: JavaMethod }[] = [];
    for (const typeName of hierarchy) {
      declared = this.methodsNamed(typeName, name, arity);
      if (declared.length > 0) break;
    }
    const targets: Target[] = [];
    const concrete = declared.filter((d) => d.method.hasBody);
    const directBasis: CallEdgeBasis = concrete.length > 1 ? 'AMBIGUOUS_OVERLOAD' : 'DIRECT';
    for (const d of concrete) targets.push({ nodeId: d.id, basis: directBasis });

    // Overrides / implementations in project subtypes (CHA).
    if (declared.length > 0) {
      for (const sub of this.index.subtypesOf(owner)) {
        for (const d of this.methodsNamed(sub, name, arity)) {
          if (d.method.hasBody) targets.push({ nodeId: d.id, basis: 'INTERFACE_DISPATCH' });
        }
      }
    }
    return targets;
  }

  /** Methods of one type named `name`: exact argument count first, any count as a fallback. */
  private methodsNamed(typeName: string, name: string, arity: number | undefined): { id: string; method: JavaMethod }[] {
    const indexed = this.index.get(typeName);
    if (!indexed) return [];
    const named = indexed.type.methods
      .map((method, i) => ({ id: nodeId(typeName, i), method }))
      .filter((d) => d.method.name === name && !d.method.isConstructor);
    if (arity === undefined) return named;
    const exact = named.filter((d) => d.method.parameters.length === arity);
    return exact.length > 0 ? exact : named;
  }

  private inheritsFromExternal(qualifiedName: string): boolean {
    return [qualifiedName, ...this.index.supertypesOf(qualifiedName)].some((t) => this.index.hasExternalSupertype(t));
  }

  /** Type a call's qualifier denotes: a variable / field's declared type, or a type for a static call. */
  private resolveReceiver(
    qualifier: string | undefined,
    scope: JavaMemberScope,
    file: AnalyzedJavaFile,
    at: SourceLocation,
  ): Receiver {
    const context = scope.typeQualifiedName;
    if (qualifier === undefined || qualifier === 'this') return { kind: 'PROJECT', qualifiedName: context, implicit: true };

    let segments = qualifier.split('.');
    if (segments[0] === 'this') segments = segments.slice(1);
    const [first, ...rest] = segments as [string, ...string[]];

    let current: Receiver | undefined;
    const variableType = this.variableType(first, scope, file, at);
    if (variableType !== undefined) {
      current = this.toReceiver(this.index.resolve(variableType.typeName, variableType.file, variableType.context));
    } else {
      // Not a variable: the longest prefix that names a type is a static call's owner.
      for (let n = segments.length; n > 0; n--) {
        const written = segments.slice(0, n).join('.');
        const resolved = this.index.resolve(written, file, context);
        if (resolved.kind === 'PROJECT') {
          current = { kind: 'PROJECT', qualifiedName: resolved.qualifiedName, implicit: false };
          segments = segments.slice(n);
          return this.followFields(current, segments);
        }
      }
      // `Foo.bar()`, `java.util.Objects.x()`: written like a type or package — external.
      if (/^[A-Z]/.test(first) || (segments.length > 1 && /^[a-z]/.test(first) && looksLikePackage(segments))) {
        return { kind: 'EXTERNAL' };
      }
      return { kind: 'UNKNOWN', reason: `unknown receiver '${first}'` };
    }
    return this.followFields(current, rest);
  }

  /** `a.b.c` after `a` was resolved: each further segment is a field of the previous type. */
  private followFields(start: Receiver, fields: readonly string[]): Receiver {
    let current = start;
    for (const name of fields) {
      if (current.kind !== 'PROJECT') return current;
      const owner = current.qualifiedName;
      const field = this.findField(owner, name);
      if (!field) {
        return this.inheritsFromExternal(owner)
          ? { kind: 'EXTERNAL' }
          : { kind: 'UNKNOWN', reason: `unknown field '${name}' on ${owner}` };
      }
      current = this.toReceiver(this.index.resolve(field.typeName, field.file, field.context));
    }
    return current.kind === 'PROJECT' ? { ...current, implicit: false } : current;
  }

  private toReceiver(resolution: ReturnType<TypeIndex['resolve']>): Receiver {
    return resolution.kind === 'PROJECT'
      ? { kind: 'PROJECT', qualifiedName: resolution.qualifiedName, implicit: false }
      : { kind: 'EXTERNAL' };
  }

  /**
   * Declared type of `name` at `at`: a local / parameter of the same method (the nearest earlier
   * declaration), else a field of the enclosing class, its supertypes, or a lexically enclosing class.
   */
  private variableType(
    name: string,
    scope: JavaMemberScope,
    file: AnalyzedJavaFile,
    at: SourceLocation,
  ): { typeName: string; file: AnalyzedJavaFile; context: string } | undefined {
    if (scope.methodIndex !== undefined) {
      const locals = file.variables.filter(
        (v) =>
          v.name === name &&
          v.scope?.typeQualifiedName === scope.typeQualifiedName &&
          v.scope.methodIndex === scope.methodIndex,
      );
      const before = locals.filter((v) => v.location.line <= at.line);
      const chosen = before[before.length - 1] ?? locals[0];
      if (chosen) return { typeName: chosen.typeName, file, context: scope.typeQualifiedName };
    }
    for (const owner of enclosingTypes(scope.typeQualifiedName)) {
      if (!this.index.get(owner)) continue;
      const field = this.findField(owner, name);
      if (field) return field;
    }
    return undefined;
  }

  private findField(
    owner: string,
    name: string,
  ): { typeName: string; file: AnalyzedJavaFile; context: string } | undefined {
    for (const typeName of [owner, ...this.index.supertypesOf(owner)]) {
      const indexed = this.index.get(typeName);
      const field = indexed?.type.fields.find((f) => f.name === name);
      if (indexed && field) return { typeName: field.typeName, file: indexed.file, context: typeName };
    }
    return undefined;
  }

  /** Owner type of a statically imported method `name`, `EXTERNAL`, or undefined when not imported. */
  private staticImportOwner(name: string, file: AnalyzedJavaFile): string | 'EXTERNAL' | undefined {
    for (const imported of file.imports) {
      if (!imported.isStatic) continue;
      const owner = imported.isWildcard
        ? imported.name
        : imported.name.endsWith(`.${name}`)
          ? imported.name.slice(0, -name.length - 1)
          : undefined;
      if (!owner) continue;
      if (this.index.get(owner)) {
        if (imported.isWildcard && !this.index.get(owner)?.type.methods.some((m) => m.name === name)) continue;
        return owner;
      }
      if (!imported.isWildcard) return 'EXTERNAL';
    }
    return undefined;
  }
}

function constructorIds(className: string, methods: readonly JavaMethod[]): string[] {
  return methods.flatMap((m, i) => (m.isConstructor ? [nodeId(className, i)] : []));
}

/** `a.b.Outer.Inner` → `a.b.Outer.Inner`, `a.b.Outer`, `a.b`, `a` (only project types are used). */
function enclosingTypes(qualifiedName: string): string[] {
  const parts = qualifiedName.split('.');
  const out: string[] = [];
  for (let n = parts.length; n > 0; n--) out.push(parts.slice(0, n).join('.'));
  return out;
}

function looksLikePackage(segments: readonly string[]): boolean {
  return segments.some((s) => /^[A-Z]/.test(s));
}

function sameLocation(a: SourceLocation, b: SourceLocation): boolean {
  return a.filePath === b.filePath && a.line === b.line && a.column === b.column;
}

function snippetAt(file: AnalyzedJavaFile, location: SourceLocation): string {
  return (file.lines[location.line - 1] ?? '').trim();
}
