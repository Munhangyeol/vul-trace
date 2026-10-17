import type { SourceLocation } from '@vulntrace/shared';
import type {
  JavaAnnotation,
  JavaFileAnalysis,
  JavaImport,
  JavaMethodInvocation,
  JavaNameReference,
  JavaObjectCreation,
  JavaType,
  JavaVariableDeclaration,
} from '../types.js';
import type { JavaSourceParser } from './JavaSourceParser.js';
import { tokenizeJava } from './JavaTokenizer.js';
import type { JavaToken } from './JavaTokenizer.js';

const isSymbol = (token: JavaToken | undefined, value: string): boolean =>
  token?.kind === 'symbol' && token.value === value;

const isKeyword = (token: JavaToken | undefined, value: string): boolean =>
  token?.kind === 'keyword' && token.value === value;

const isIdentifier = (token: JavaToken | undefined): token is JavaToken =>
  token?.kind === 'identifier';

/** Tokens that may directly precede a method/constructor name in a member declaration. */
const DECLARATION_PRECEDING_SYMBOLS = new Set(['>', ']', ')', '{', '}', ';']);
const NON_DECLARATION_KEYWORDS = new Set(['new', 'return', 'throw', 'case', 'else', 'assert']);
/** Tokens that can follow `Type name` in a field / parameter / local declaration. */
const DECLARATION_TERMINATORS = new Set(['=', ';', ',', ')', ':']);
/** Tokens allowed inside `<...>` type arguments. */
const TYPE_ARGUMENT_SYMBOLS = new Set(['.', ',', '?', '[', ']', '&', '@', '<', '>']);
const MAX_TYPE_ARGUMENT_TOKENS = 200;

interface OpenType {
  type: JavaType;
  /** Brace depth inside the type body. */
  bodyDepth: number;
  /** Enum bodies start with constants (`A("x"), B;`) that must not be read as methods. */
  inEnumConstants: boolean;
}

/**
 * Stage A Java parser (CLAUDE.md §5, §14): a tokenizer plus two passes over the token stream.
 *
 * 1. Structure: package, imports, annotations, type and method declarations (brace-depth based).
 * 2. References: `new T(...)`, `q.m(...)`, `q::m`, `T name` declarations, dotted names.
 *
 * It does not build a full AST or resolve types — that is left to the usage matcher and, if more
 * precision is needed later, a Stage B analyzer behind the same `JavaSourceParser` interface.
 */
export class LightweightJavaParser implements JavaSourceParser {
  parse(filePath: string, content: string): JavaFileAnalysis {
    const tokens = tokenizeJava(content);
    const loc = (token: JavaToken): SourceLocation => ({
      filePath,
      line: token.line,
      column: token.column,
    });

    /** Token indices already accounted for (package/import statements, declaration names). */
    const excluded = new Set<number>();
    const imports: JavaImport[] = [];
    const types: JavaType[] = [];
    let packageName: string | undefined;

    // ---- Pass 1: structure ------------------------------------------------------------------
    const typeStack: OpenType[] = [];
    let pendingType: OpenType | undefined;
    let pendingAnnotations: JavaAnnotation[] = [];
    let depth = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as JavaToken;
      const top = typeStack[typeStack.length - 1];

      if (isSymbol(token, '{')) {
        depth += 1;
        if (pendingType) {
          pendingType.bodyDepth = depth;
          typeStack.push(pendingType);
          pendingType = undefined;
        }
        pendingAnnotations = [];
        continue;
      }
      if (isSymbol(token, '}')) {
        if (top && top.bodyDepth === depth) typeStack.pop();
        depth = Math.max(0, depth - 1);
        pendingAnnotations = [];
        continue;
      }
      if (isSymbol(token, ';')) {
        if (top && top.bodyDepth === depth) top.inEnumConstants = false;
        pendingAnnotations = [];
        continue;
      }

      const atMemberLevel = depth === 0 || (top !== undefined && top.bodyDepth === depth);

      if (depth === 0 && (isKeyword(token, 'package') || isKeyword(token, 'import'))) {
        const end = findStatementEnd(tokens, i);
        for (let k = i; k <= end; k++) excluded.add(k);
        if (isKeyword(token, 'package')) {
          packageName = readQualifiedName(tokens, i + 1).name;
        } else {
          const isStatic = isKeyword(tokens[i + 1], 'static');
          const nameStart = isStatic ? i + 2 : i + 1;
          const { name, end: nameEnd } = readQualifiedName(tokens, nameStart);
          const isWildcard = isSymbol(tokens[nameEnd], '.') && isSymbol(tokens[nameEnd + 1], '*');
          if (name) imports.push({ name, isStatic, isWildcard, location: loc(token) });
        }
        i = end;
        continue;
      }

      if (isSymbol(token, '@') && isIdentifier(tokens[i + 1])) {
        const { name, end } = readQualifiedName(tokens, i + 1);
        for (let k = i + 1; k < end; k++) excluded.add(k);
        let rawArguments: string | undefined;
        let annotationEnd = end - 1;
        if (isSymbol(tokens[end], '(')) {
          const close = findMatching(tokens, end, '(', ')');
          const closeToken = tokens[close];
          if (closeToken) {
            rawArguments = content.slice((tokens[end] as JavaToken).end, closeToken.start).trim();
            annotationEnd = close;
          }
        }
        if (atMemberLevel) {
          pendingAnnotations.push({
            name,
            ...(rawArguments ? { rawArguments } : {}),
            location: loc(token),
          });
        }
        // Annotation arguments stay visible to pass 2 (e.g. `Foo.class`); only skip them here.
        i = annotationEnd;
        continue;
      }

      const typeKind = typeDeclarationKind(tokens, i);
      if (typeKind) {
        const nameIndex = typeKind === 'annotation' ? i + 2 : i + 1;
        const nameToken = tokens[nameIndex] as JavaToken;
        const qualifiedName = top
          ? `${top.type.qualifiedName}.${nameToken.value}`
          : packageName
            ? `${packageName}.${nameToken.value}`
            : nameToken.value;
        const type: JavaType = {
          name: nameToken.value,
          qualifiedName,
          kind: typeKind,
          annotations: pendingAnnotations,
          methods: [],
          location: loc(nameToken),
        };
        types.push(type);
        excluded.add(nameIndex);
        pendingAnnotations = [];
        pendingType = { type, bodyDepth: -1, inEnumConstants: typeKind === 'enum' };
        i = nameIndex;
        continue;
      }

      if (
        !pendingType &&
        top &&
        top.bodyDepth === depth &&
        !top.inEnumConstants &&
        isMethodDeclaration(tokens, i)
      ) {
        top.type.methods.push({ name: token.value, annotations: pendingAnnotations, location: loc(token) });
        excluded.add(i);
        pendingAnnotations = [];
      }
    }

    // ---- Pass 2: references -----------------------------------------------------------------
    const objectCreations: JavaObjectCreation[] = [];
    const invocations: JavaMethodInvocation[] = [];
    const variables: JavaVariableDeclaration[] = [];
    const nameReferences: JavaNameReference[] = [];

    for (let i = 0; i < tokens.length; i++) {
      if (excluded.has(i)) continue;
      const token = tokens[i] as JavaToken;
      const startsWithThis =
        isKeyword(token, 'this') && isSymbol(tokens[i + 1], '.') && isIdentifier(tokens[i + 2]);
      if (!isIdentifier(token) && !startsWithThis) continue;

      const prev = tokens[i - 1];
      const chained = !startsWithThis && isSymbol(prev, '.');

      const segments: JavaToken[] = [token];
      let j = i + 1;
      while (isSymbol(tokens[j], '.') && isIdentifier(tokens[j + 1]) && !excluded.has(j + 1)) {
        segments.push(tokens[j + 1] as JavaToken);
        j += 2;
      }
      const after = tokens[j];
      const name = segments.map((s) => s.value).join('.');
      const head = segments[0] as JavaToken;
      const last = segments[segments.length - 1] as JavaToken;

      if (!chained && isKeyword(prev, 'new')) {
        objectCreations.push({ typeName: name, location: loc(head) });
      } else if (isSymbol(after, '(')) {
        invocations.push({
          name: last.value,
          ...(segments.length > 1 ? { qualifier: segments.slice(0, -1).map((s) => s.value).join('.') } : {}),
          chained,
          kind: 'CALL',
          location: loc(last),
        });
      } else if (isSymbol(after, '::')) {
        const member = tokens[j + 1];
        if (!chained && isKeyword(member, 'new')) {
          objectCreations.push({ typeName: name, location: loc(head) });
        } else if (isIdentifier(member)) {
          invocations.push({
            name: member.value,
            qualifier: name,
            chained,
            kind: 'METHOD_REFERENCE',
            location: loc(member),
          });
        }
      } else if (!chained) {
        const variableIndex = matchDeclaration(tokens, j);
        const variableToken = variableIndex >= 0 ? tokens[variableIndex] : undefined;
        if (variableToken) {
          if (name !== 'var') {
            variables.push({ typeName: name, name: variableToken.value, location: loc(variableToken) });
          } else if (isKeyword(tokens[variableIndex + 2], 'new')) {
            const created = readQualifiedName(tokens, variableIndex + 3).name;
            if (created) {
              variables.push({ typeName: created, name: variableToken.value, location: loc(variableToken) });
            }
          }
        }
        if (segments.length >= 2 && !startsWithThis) {
          nameReferences.push({ name, location: loc(head) });
        }
      }

      i = j - 1;
    }

    return {
      filePath,
      ...(packageName ? { packageName } : {}),
      imports,
      types,
      objectCreations,
      invocations,
      variables,
      nameReferences,
      lines: content.split(/\r?\n/),
    };
  }
}

/** Reads `a.b.c` starting at `start`; `end` is the index just past the last identifier. */
function readQualifiedName(tokens: readonly JavaToken[], start: number): { name: string; end: number } {
  const first = tokens[start];
  if (!isIdentifier(first)) return { name: '', end: start };
  const parts = [first.value];
  let i = start + 1;
  while (isSymbol(tokens[i], '.') && isIdentifier(tokens[i + 1])) {
    parts.push((tokens[i + 1] as JavaToken).value);
    i += 2;
  }
  return { name: parts.join('.'), end: i };
}

function findStatementEnd(tokens: readonly JavaToken[], start: number): number {
  for (let i = start; i < tokens.length; i++) {
    if (isSymbol(tokens[i], ';')) return i;
  }
  return tokens.length - 1;
}

/** Index of the bracket closing the one at `openIndex`, or -1 when unbalanced. */
function findMatching(tokens: readonly JavaToken[], openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (isSymbol(tokens[i], open)) depth += 1;
    else if (isSymbol(tokens[i], close)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function typeDeclarationKind(tokens: readonly JavaToken[], i: number): JavaType['kind'] | undefined {
  const token = tokens[i];
  const prev = tokens[i - 1];
  if (isSymbol(prev, '.')) return undefined; // `Foo.class`

  if (isSymbol(token, '@') && isKeyword(tokens[i + 1], 'interface') && isIdentifier(tokens[i + 2])) {
    return 'annotation';
  }
  if (!isIdentifier(tokens[i + 1])) return undefined;
  if (isKeyword(token, 'class')) return 'class';
  if (isKeyword(token, 'interface')) return 'interface';
  if (isKeyword(token, 'enum')) return 'enum';
  // `record` is contextual: `record Point(int x, int y)` or `record Box<T>(T value)`.
  if (isIdentifier(token) && token.value === 'record') {
    const afterName = tokens[i + 2];
    if (isSymbol(afterName, '(') || isSymbol(afterName, '<')) return 'record';
  }
  return undefined;
}

function isMethodDeclaration(tokens: readonly JavaToken[], i: number): boolean {
  const token = tokens[i];
  if (!isIdentifier(token) || !isSymbol(tokens[i + 1], '(')) return false;

  const prev = tokens[i - 1];
  if (prev) {
    if (prev.kind === 'symbol' && !DECLARATION_PRECEDING_SYMBOLS.has(prev.value)) return false;
    if (prev.kind === 'keyword' && NON_DECLARATION_KEYWORDS.has(prev.value)) return false;
    if (prev.kind === 'string' || prev.kind === 'char' || prev.kind === 'number') return false;
  }

  const close = findMatching(tokens, i + 1, '(', ')');
  if (close < 0) return false;
  const next = tokens[close + 1];
  return (
    isSymbol(next, '{') || isSymbol(next, ';') || isKeyword(next, 'throws') || isKeyword(next, 'default')
  );
}

/** Index just past `<...>` starting at `start`, or -1 if the tokens are not type arguments. */
function skipTypeArguments(tokens: readonly JavaToken[], start: number): number {
  let depth = 0;
  for (let i = start; i < tokens.length && i - start < MAX_TYPE_ARGUMENT_TOKENS; i++) {
    const token = tokens[i] as JavaToken;
    if (isSymbol(token, '<')) depth += 1;
    else if (isSymbol(token, '>')) {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (token.kind === 'symbol' && !TYPE_ARGUMENT_SYMBOLS.has(token.value)) return -1;
    else if (token.kind === 'string' || token.kind === 'char' || token.kind === 'number') return -1;
  }
  return -1;
}

/**
 * Given the index just past a type name, returns the index of the declared variable name when the
 * tokens form `Type[<...>][[]...][...] name (= | ; | , | ) | :)`, otherwise -1.
 */
function matchDeclaration(tokens: readonly JavaToken[], start: number): number {
  let k = start;
  if (isSymbol(tokens[k], '<')) {
    k = skipTypeArguments(tokens, k);
    if (k < 0) return -1;
  }
  while (isSymbol(tokens[k], '[') && isSymbol(tokens[k + 1], ']')) k += 2;
  if (isSymbol(tokens[k], '...')) k += 1;
  if (!isIdentifier(tokens[k])) return -1;
  const terminator = tokens[k + 1];
  return terminator?.kind === 'symbol' && DECLARATION_TERMINATORS.has(terminator.value) ? k : -1;
}
