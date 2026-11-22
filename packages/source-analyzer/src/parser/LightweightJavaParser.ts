import type { SourceLocation } from '@vulntrace/shared';
import type {
  JavaAnnotation,
  JavaField,
  JavaFileAnalysis,
  JavaImport,
  JavaMemberScope,
  JavaMethodInvocation,
  JavaNameReference,
  JavaObjectCreation,
  JavaType,
  JavaVariableDeclaration,
  SourcePosition,
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
  /** Token index of the type name. */
  startIndex: number;
}

/** Token span of a declaration, used to give pass-2 references their enclosing member. */
interface TokenSpan {
  start: number;
  end: number;
}

interface TypeSpan extends TokenSpan {
  type: JavaType;
  /** Brace depth of the type's member level. */
  bodyDepth: number;
}

interface MethodSpan extends TokenSpan {
  typeQualifiedName: string;
  methodIndex: number;
}

const PRIMITIVE_TYPES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']);

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
    /** Brace depth before each token (index-aligned with `tokens`). */
    const depthAt: number[] = new Array<number>(tokens.length).fill(0);
    const typeSpans: TypeSpan[] = [];
    const methodSpans: MethodSpan[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as JavaToken;
      const top = typeStack[typeStack.length - 1];
      depthAt[i] = depth;

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
        if (top && top.bodyDepth === depth) {
          typeStack.pop();
          top.type.range = { start: top.type.range.start, end: endPosition(token) };
          typeSpans.push({ type: top.type, bodyDepth: top.bodyDepth, start: top.startIndex, end: i });
        }
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
        const superTypes = readSuperTypes(tokens, nameIndex + 1);
        const type: JavaType = {
          name: nameToken.value,
          qualifiedName,
          kind: typeKind,
          annotations: pendingAnnotations,
          methods: [],
          fields: [],
          extendsTypes: superTypes.extendsTypes,
          implementsTypes: superTypes.implementsTypes,
          location: loc(nameToken),
          range: { start: startPosition(nameToken), end: endPosition(nameToken) },
        };
        types.push(type);
        excluded.add(nameIndex);
        pendingAnnotations = [];
        pendingType = { type, bodyDepth: -1, inEnumConstants: typeKind === 'enum', startIndex: nameIndex };
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
        const paramsClose = findMatching(tokens, i + 1, '(', ')');
        const declarationEnd = findDeclarationEnd(tokens, paramsClose + 1);
        const endToken = tokens[declarationEnd.end] ?? (tokens[tokens.length - 1] as JavaToken);
        top.type.methods.push({
          name: token.value,
          annotations: pendingAnnotations,
          location: loc(token),
          isConstructor: token.value === top.type.name,
          parameters: readParameters(tokens, i + 1, paramsClose).map((p) => ({
            typeName: p.typeName,
            name: p.nameToken.value,
            location: loc(p.nameToken),
          })),
          hasBody: declarationEnd.hasBody,
          range: { start: startPosition(token), end: endPosition(endToken) },
        });
        methodSpans.push({
          typeQualifiedName: top.type.qualifiedName,
          methodIndex: top.type.methods.length - 1,
          start: i,
          end: declarationEnd.end,
        });
        excluded.add(i);
        pendingAnnotations = [];
      }
    }

    // Unclosed types (malformed input) still get a span reaching the end of the file.
    for (const open of typeStack) {
      typeSpans.push({ type: open.type, bodyDepth: open.bodyDepth, start: open.startIndex, end: tokens.length - 1 });
    }

    /** Innermost method, else innermost type, containing the token at `index`. */
    const withScope = (index: number): { scope?: JavaMemberScope } => {
      const method = innermost(methodSpans, index);
      if (method) return { scope: { typeQualifiedName: method.typeQualifiedName, methodIndex: method.methodIndex } };
      const type = innermost(typeSpans, index);
      return type ? { scope: { typeQualifiedName: type.type.qualifiedName } } : {};
    };

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
        objectCreations.push({ typeName: name, location: loc(head), ...withScope(i) });
      } else if (isSymbol(after, '(')) {
        invocations.push({
          name: last.value,
          ...(segments.length > 1 ? { qualifier: segments.slice(0, -1).map((s) => s.value).join('.') } : {}),
          chained,
          kind: 'CALL',
          location: loc(last),
          argumentCount: countArguments(tokens, j),
          ...withScope(i),
        });
      } else if (isSymbol(after, '::')) {
        const member = tokens[j + 1];
        if (!chained && isKeyword(member, 'new')) {
          objectCreations.push({ typeName: name, location: loc(head), ...withScope(i) });
        } else if (isIdentifier(member)) {
          invocations.push({
            name: member.value,
            qualifier: name,
            chained,
            kind: 'METHOD_REFERENCE',
            location: loc(member),
            ...withScope(i),
          });
        }
      } else if (!chained) {
        const variableIndex = matchDeclaration(tokens, j);
        const variableToken = variableIndex >= 0 ? tokens[variableIndex] : undefined;
        if (variableToken) {
          let typeName: string | undefined;
          if (name !== 'var') {
            typeName = name;
          } else if (isKeyword(tokens[variableIndex + 2], 'new')) {
            typeName = readQualifiedName(tokens, variableIndex + 3).name || undefined;
          }
          if (typeName) {
            const declared: JavaVariableDeclaration = {
              typeName,
              name: variableToken.value,
              location: loc(variableToken),
              ...withScope(i),
            };
            variables.push(declared);
            const owner = declared.scope?.methodIndex === undefined ? innermost(typeSpans, i) : undefined;
            if (owner && depthAt[i] === owner.bodyDepth) {
              const field: JavaField = { typeName, name: declared.name, location: declared.location };
              owner.type.fields.push(field);
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

function startPosition(token: JavaToken): SourcePosition {
  return { line: token.line, column: token.column };
}

/** Position of the last character of `token`. */
function endPosition(token: JavaToken): SourcePosition {
  const lines = token.value.split(/\r?\n/);
  if (lines.length === 1) return { line: token.line, column: token.column + Math.max(0, token.value.length - 1) };
  const lastLine = lines[lines.length - 1] as string;
  return { line: token.line + lines.length - 1, column: Math.max(1, lastLine.length) };
}

/** The span with the greatest start that contains `index` (spans nest, so it is the innermost). */
function innermost<T extends TokenSpan>(spans: readonly T[], index: number): T | undefined {
  let best: T | undefined;
  for (const span of spans) {
    if (span.start <= index && index <= span.end && (!best || span.start > best.start)) best = span;
  }
  return best;
}

/**
 * After a method's `)`, skips `throws ...` / `default ...` and returns the index of the body's
 * closing `}` (`hasBody`) or of the terminating `;`.
 */
function findDeclarationEnd(tokens: readonly JavaToken[], start: number): { end: number; hasBody: boolean } {
  for (let k = start; k < tokens.length; k++) {
    if (isSymbol(tokens[k], '{')) {
      const close = findMatching(tokens, k, '{', '}');
      return { end: close < 0 ? tokens.length - 1 : close, hasBody: true };
    }
    if (isSymbol(tokens[k], ';')) return { end: k, hasBody: false };
  }
  return { end: tokens.length - 1, hasBody: false };
}

/** Reads `extends A, B<C>` / `implements X` between a type name and its body. */
function readSuperTypes(
  tokens: readonly JavaToken[],
  start: number,
): { extendsTypes: string[]; implementsTypes: string[] } {
  const extendsTypes: string[] = [];
  const implementsTypes: string[] = [];
  let mode: 'none' | 'extends' | 'implements' = 'none';
  let angle = 0;
  let paren = 0;
  let expectName = false;
  for (let k = start; k < tokens.length; k++) {
    const token = tokens[k] as JavaToken;
    if (angle === 0 && paren === 0 && (isSymbol(token, '{') || isSymbol(token, ';'))) break;
    if (isSymbol(token, '<')) angle += 1;
    else if (isSymbol(token, '>')) angle = Math.max(0, angle - 1);
    else if (isSymbol(token, '(')) paren += 1;
    else if (isSymbol(token, ')')) paren = Math.max(0, paren - 1);
    if (angle > 0 || paren > 0 || isSymbol(token, '>') || isSymbol(token, ')')) continue;

    if (isKeyword(token, 'extends')) {
      mode = 'extends';
      expectName = true;
    } else if (isKeyword(token, 'implements')) {
      mode = 'implements';
      expectName = true;
    } else if (isIdentifier(token) && token.value === 'permits') {
      mode = 'none';
      expectName = false;
    } else if (isSymbol(token, ',')) {
      expectName = mode !== 'none';
    } else if (expectName && isIdentifier(token)) {
      const { name, end } = readQualifiedName(tokens, k);
      (mode === 'extends' ? extendsTypes : implementsTypes).push(name);
      expectName = false;
      k = end - 1;
    }
  }
  return { extendsTypes, implementsTypes };
}

/** Parameters between the `(` at `open` and the `)` at `close`, skipping annotations and `final`. */
function readParameters(
  tokens: readonly JavaToken[],
  open: number,
  close: number,
): { typeName: string; nameToken: JavaToken }[] {
  if (close < 0) return [];
  const segments: JavaToken[][] = [];
  let current: JavaToken[] = [];
  let nesting = 0;
  for (let k = open + 1; k < close; k++) {
    const token = tokens[k] as JavaToken;
    if (isSymbol(token, '(') || isSymbol(token, '<')) nesting += 1;
    else if (isSymbol(token, ')') || isSymbol(token, '>')) nesting = Math.max(0, nesting - 1);
    if (nesting === 0 && isSymbol(token, ',')) {
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) segments.push(current);

  const parameters: { typeName: string; nameToken: JavaToken }[] = [];
  for (const segment of segments) {
    const rest = stripParameterModifiers(segment);
    const first = rest[0];
    if (!first) continue;
    const typeName =
      first.kind === 'keyword' && PRIMITIVE_TYPES.has(first.value) ? first.value : readQualifiedName(rest, 0).name;
    if (!typeName) continue;
    let last = rest.length - 1;
    while (last > 0 && (isSymbol(rest[last], ']') || isSymbol(rest[last], '['))) last -= 1;
    const nameToken = rest[last];
    // `Foo this` (receiver parameter) and malformed segments carry no usable name.
    if (last === 0 || !isIdentifier(nameToken)) continue;
    parameters.push({ typeName, nameToken });
  }
  return parameters;
}

/** Drops leading `@Annotation(...)` and `final` tokens from a parameter. */
function stripParameterModifiers(segment: readonly JavaToken[]): JavaToken[] {
  let k = 0;
  while (k < segment.length) {
    if (isKeyword(segment[k], 'final')) {
      k += 1;
    } else if (isSymbol(segment[k], '@') && isIdentifier(segment[k + 1])) {
      k = readQualifiedName(segment, k + 1).end;
      if (isSymbol(segment[k], '(')) {
        const close = findMatching(segment, k, '(', ')');
        k = close < 0 ? segment.length : close + 1;
      }
    } else {
      break;
    }
  }
  return segment.slice(k);
}

/** Top-level argument count of the call whose `(` is at `open`. */
function countArguments(tokens: readonly JavaToken[], open: number): number {
  let nesting = 0;
  let commas = 0;
  let empty = true;
  for (let k = open; k < tokens.length; k++) {
    const token = tokens[k] as JavaToken;
    if (isSymbol(token, '(') || isSymbol(token, '{') || isSymbol(token, '[')) {
      nesting += 1;
      if (k === open) continue;
    } else if (isSymbol(token, ')') || isSymbol(token, '}') || isSymbol(token, ']')) {
      nesting -= 1;
      if (nesting === 0) return empty ? 0 : commas + 1;
    } else if (nesting === 1 && isSymbol(token, ',')) {
      commas += 1;
    }
    empty = false;
  }
  return empty ? 0 : commas + 1;
}
