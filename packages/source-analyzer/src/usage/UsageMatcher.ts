import type { PackageMapping, SourceLocation, SourceUsage, UsageKind } from '@vulntrace/shared';
import type { AnalyzedJavaFile, JavaAnalysisResult } from '../types.js';
import { resolvePackageMapping } from './artifactPackages.js';

export interface DependencyRef {
  groupId: string;
  artifactId: string;
  purl: string;
}

/** A usage before it is checked against a specific vulnerability's API list. */
export type MatchedUsage = Omit<SourceUsage, 'vulnerableApi'>;

export interface DependencyUsage {
  purl: string;
  packageMapping: PackageMapping;
  /** Ordered by file, line, column. */
  usages: MatchedUsage[];
}

const MAX_SNIPPET_LENGTH = 200;

interface PackageOwner {
  prefix: string;
  purl: string;
}

/** Finds the dependencies providing a fully qualified name: longest package prefix wins, ties all count. */
function createOwnerLookup(owners: readonly PackageOwner[]): (fqn: string) => string[] {
  return (fqn) => {
    let bestLength = -1;
    let best: string[] = [];
    for (const { prefix, purl } of owners) {
      if (fqn !== prefix && !fqn.startsWith(`${prefix}.`)) continue;
      if (prefix.length > bestLength) {
        bestLength = prefix.length;
        best = [purl];
      } else if (prefix.length === bestLength && !best.includes(purl)) {
        best.push(purl);
      }
    }
    return best;
  };
}

const startsUppercase = (name: string): boolean => /^[A-Z]/.test(name);
const startsLowercase = (name: string): boolean => /^[a-z]/.test(name);

function snippetAt(file: AnalyzedJavaFile, line: number): string {
  const text = (file.lines[line - 1] ?? '').trim();
  return text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…` : text;
}

/**
 * Matches parsed Java files against dependencies and returns per-dependency usage evidence
 * (CLAUDE.md §7 Phase 4). Pure function: the same analysis always gives the same result.
 *
 * Names are resolved the way Java does, simplified for Stage A: a type declared anywhere in the
 * project → project code; a single-type import → that type; a wildcard import of a dependency
 * package → assumed to come from it; a lowercase dotted name → a package-qualified name.
 */
export function matchDependencyUsages(
  analysis: JavaAnalysisResult,
  dependencies: readonly DependencyRef[],
): DependencyUsage[] {
  const results = dependencies.map(
    (dep): DependencyUsage => ({
      purl: dep.purl,
      packageMapping: resolvePackageMapping(dep.groupId, dep.artifactId),
      usages: [],
    }),
  );
  const byPurl = new Map(results.map((r) => [r.purl, r]));
  const ownersOf = createOwnerLookup(
    results.flatMap((r) => r.packageMapping.packages.map((prefix) => ({ prefix, purl: r.purl }))),
  );

  const projectTypeNames = new Set(analysis.files.flatMap((f) => f.types.map((t) => t.name)));
  const seen = new Set<string>();

  for (const file of analysis.files) {
    const record = (kind: UsageKind, symbol: string, ownerFqn: string, location: SourceLocation): void => {
      for (const purl of ownersOf(ownerFqn)) {
        const key = `${purl}|${kind}|${symbol}|${location.filePath}|${location.line}|${location.column ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byPurl.get(purl)?.usages.push({
          kind,
          symbol,
          dependencyPurl: purl,
          sourceSet: file.sourceSet,
          evidence: { location, snippet: snippetAt(file, location.line) },
        });
      }
    };

    const singleImports = new Map<string, string>();
    const wildcardPackages: string[] = [];
    const staticMembers = new Map<string, string>();
    for (const imp of file.imports) {
      const lastDot = imp.name.lastIndexOf('.');
      if (imp.isWildcard) {
        if (!imp.isStatic) wildcardPackages.push(imp.name);
      } else if (imp.isStatic) {
        if (lastDot > 0) staticMembers.set(imp.name.slice(lastDot + 1), imp.name.slice(0, lastDot));
      } else {
        singleImports.set(imp.name.slice(lastDot + 1), imp.name);
      }
    }

    /** Resolves a type name as written to a fully qualified name, or undefined for project/JDK code. */
    const resolveTypeName = (written: string): string | undefined => {
      const segments = written.split('.');
      const head = segments[0] ?? '';
      const imported = singleImports.get(head);
      if (imported) return [imported, ...segments.slice(1)].join('.');
      if (projectTypeNames.has(head)) return undefined;
      if (startsLowercase(head) && segments.length >= 2) return written;
      if (startsUppercase(head)) {
        for (const pkg of wildcardPackages) {
          const candidate = `${pkg}.${written}`;
          if (ownersOf(candidate).length > 0) return candidate;
        }
      }
      return undefined;
    };

    // Variable name → declared dependency type. Scopes are flattened to the file, so a name
    // declared with more than one type anywhere in the file is ambiguous and maps to `null`.
    const declaredTypes = new Map<string, Set<string>>();
    for (const variable of file.variables) {
      const key = resolveTypeName(variable.typeName) ?? variable.typeName;
      const types = declaredTypes.get(variable.name) ?? new Set<string>();
      types.add(key);
      declaredTypes.set(variable.name, types);
    }
    const variableTypes = new Map<string, string | null>();
    for (const [name, types] of declaredTypes) {
      const [only] = types;
      if (types.size > 1) variableTypes.set(name, null);
      else if (only && ownersOf(only).length > 0) variableTypes.set(name, only);
    }

    for (const imp of file.imports) {
      const target = imp.isStatic && !imp.isWildcard ? imp.name.slice(0, imp.name.lastIndexOf('.')) : imp.name;
      const symbol = imp.isWildcard ? `${imp.name}.*` : imp.name;
      record('IMPORT', symbol, target, imp.location);
    }

    for (const reference of file.nameReferences) {
      const head = reference.name.split('.')[0] ?? '';
      if (!startsLowercase(head) || singleImports.has(head) || declaredTypes.has(head)) continue;
      record('PACKAGE_REFERENCE', reference.name, reference.name, reference.location);
    }

    for (const creation of file.objectCreations) {
      const fqn = resolveTypeName(creation.typeName);
      if (fqn) record('OBJECT_CONSTRUCTION', fqn, fqn, creation.location);
    }

    for (const invocation of file.invocations) {
      if (invocation.chained) continue;
      let ownerType: string | undefined;
      if (invocation.qualifier === undefined) {
        if (invocation.kind === 'CALL') ownerType = staticMembers.get(invocation.name);
      } else {
        const qualifier = invocation.qualifier.startsWith('this.')
          ? invocation.qualifier.slice('this.'.length)
          : invocation.qualifier;
        if (qualifier === 'this') continue;
        const variableType = variableTypes.get(qualifier);
        ownerType = variableType ?? (variableType === null ? undefined : resolveTypeName(qualifier));
      }
      if (ownerType) record('METHOD_CALL', `${ownerType}#${invocation.name}`, ownerType, invocation.location);
    }
  }

  for (const result of results) {
    result.usages.sort(
      (a, b) =>
        a.evidence.location.filePath.localeCompare(b.evidence.location.filePath) ||
        a.evidence.location.line - b.evidence.location.line ||
        (a.evidence.location.column ?? 0) - (b.evidence.location.column ?? 0),
    );
  }
  return results;
}
