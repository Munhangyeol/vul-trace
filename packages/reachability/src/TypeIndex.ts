import type { AnalyzedJavaFile, JavaType } from '@vulntrace/source-analyzer';

export interface IndexedType {
  type: JavaType;
  file: AnalyzedJavaFile;
}

/**
 * A written type name resolved against the project:
 * - `PROJECT`: a MAIN-source type of the analyzed project.
 * - `EXTERNAL`: anything else that is plainly a type (JDK, libraries, primitives) — not a graph node.
 */
export type TypeResolution = { kind: 'PROJECT'; qualifiedName: string } | { kind: 'EXTERNAL' };

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']);

/** Project types by qualified name, plus Java's name-lookup rules (CLAUDE.md §14, Stage A). */
export class TypeIndex {
  private readonly byName = new Map<string, IndexedType>();
  private readonly supertypes = new Map<string, string[]>();
  private readonly subtypes = new Map<string, string[]>();

  constructor(files: readonly AnalyzedJavaFile[]) {
    for (const file of files) {
      if (file.sourceSet !== 'MAIN') continue;
      for (const type of file.types) {
        // First declaration wins; duplicates (e.g. two modules) are rare and kept deterministic.
        if (!this.byName.has(type.qualifiedName)) this.byName.set(type.qualifiedName, { type, file });
      }
    }
    for (const { type, file } of this.byName.values()) {
      const supers: string[] = [];
      for (const written of [...type.extendsTypes, ...type.implementsTypes]) {
        const resolved = this.resolve(written, file, type.qualifiedName);
        if (resolved.kind === 'PROJECT' && resolved.qualifiedName !== type.qualifiedName) {
          supers.push(resolved.qualifiedName);
        }
      }
      this.supertypes.set(type.qualifiedName, supers);
      for (const s of supers) this.subtypes.set(s, [...(this.subtypes.get(s) ?? []), type.qualifiedName]);
    }
  }

  get(qualifiedName: string): IndexedType | undefined {
    return this.byName.get(qualifiedName);
  }

  all(): IterableIterator<IndexedType> {
    return this.byName.values();
  }

  /** Project supertypes of `qualifiedName`, nearest first, transitively, without repeats. */
  supertypesOf(qualifiedName: string): string[] {
    return this.walk(qualifiedName, this.supertypes);
  }

  /** Project subtypes (implementations / subclasses) of `qualifiedName`, transitively. */
  subtypesOf(qualifiedName: string): string[] {
    return this.walk(qualifiedName, this.subtypes);
  }

  /** True when some declared supertype of the type is not a project type (e.g. a library base class). */
  hasExternalSupertype(qualifiedName: string): boolean {
    const indexed = this.byName.get(qualifiedName);
    if (!indexed) return false;
    const declared = indexed.type.extendsTypes.length + indexed.type.implementsTypes.length;
    return declared > (this.supertypes.get(qualifiedName)?.length ?? 0);
  }

  /**
   * Resolves `written` (simple, nested `Outer.Inner`, or fully qualified) as seen from `contextType`
   * in `file`: nested types of the enclosing types, single-type imports, the same package,
   * wildcard imports, then a fully qualified name.
   */
  resolve(written: string, file: AnalyzedJavaFile, contextType?: string): TypeResolution {
    const name = written.replace(/<.*$/s, '').replace(/\[\]/g, '').trim();
    if (!name) return { kind: 'EXTERNAL' };
    if (PRIMITIVES.has(name)) return { kind: 'EXTERNAL' };

    const [head = name, ...rest] = name.split('.');
    const suffix = rest.length > 0 ? `.${rest.join('.')}` : '';
    const found = (candidate: string): TypeResolution | undefined =>
      this.byName.has(candidate) ? { kind: 'PROJECT', qualifiedName: candidate } : undefined;

    // Nested types visible from the enclosing types, innermost first.
    if (contextType) {
      const parts = contextType.split('.');
      for (let n = parts.length; n > 0; n--) {
        const hit = found(`${parts.slice(0, n).join('.')}.${name}`);
        if (hit) return hit;
      }
    }
    for (const imported of file.imports) {
      if (imported.isStatic || imported.isWildcard) continue;
      if (imported.name.endsWith(`.${head}`)) {
        return found(`${imported.name}${suffix}`) ?? { kind: 'EXTERNAL' };
      }
    }
    if (file.packageName) {
      const hit = found(`${file.packageName}.${name}`);
      if (hit) return hit;
    } else {
      const hit = found(name);
      if (hit) return hit;
    }
    for (const imported of file.imports) {
      if (imported.isStatic || !imported.isWildcard) continue;
      const hit = found(`${imported.name}.${name}`);
      if (hit) return hit;
    }
    return found(name) ?? { kind: 'EXTERNAL' };
  }

  private walk(start: string, edges: ReadonlyMap<string, readonly string[]>): string[] {
    const seen = new Set<string>([start]);
    const out: string[] = [];
    const queue = [...(edges.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(...(edges.get(next) ?? []));
    }
    return out;
  }
}
