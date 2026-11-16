import { tokenizeJava } from '@vulntrace/source-analyzer';
import type { JavaToken } from '@vulntrace/source-analyzer';

/**
 * One annotation element value. `STRING` is a string literal (or a `+` concatenation of
 * literals) whose value is known statically; anything else is kept as `EXPRESSION` text.
 */
export type ElementValue =
  | { kind: 'STRING'; value: string }
  | { kind: 'EXPRESSION'; text: string };

/** Attribute name → values; a single value and `{a, b}` both become a list. */
export type AnnotationArguments = ReadonlyMap<string, readonly ElementValue[]>;

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '{': '}', '[': ']' };
const CLOSERS = new Set(Object.values(OPENERS));

const isSymbol = (token: JavaToken | undefined, value: string): boolean =>
  token?.kind === 'symbol' && token.value === value;

/** Splits tokens at commas that are not nested in brackets. */
function splitTopLevel(tokens: readonly JavaToken[]): JavaToken[][] {
  const parts: JavaToken[][] = [];
  let current: JavaToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'symbol' && OPENERS[token.value]) depth += 1;
    else if (token.kind === 'symbol' && CLOSERS.has(token.value)) depth = Math.max(0, depth - 1);
    if (depth === 0 && isSymbol(token, ',')) {
      parts.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ', '"': '"', "'": "'", '\\': '\\',
};

/** Decodes a `"..."` literal; text blocks and unterminated literals return undefined. */
function decodeStringLiteral(literal: string): string | undefined {
  if (literal.startsWith('"""') || literal.length < 2 || !literal.endsWith('"')) return undefined;
  const body = literal.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const escaped = body[i + 1];
    const decoded = escaped === undefined ? undefined : ESCAPES[escaped];
    if (decoded === undefined) return undefined; // octal / unicode escapes: not worth guessing
    out += decoded;
    i += 1;
  }
  return out;
}

function toElementValue(tokens: readonly JavaToken[], source: string): ElementValue {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const text = first && last ? source.slice(first.start, last.end) : '';

  // "a" + "b" + ... — every odd token must be `+`, every even token a string literal.
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as JavaToken;
    if (i % 2 === 1) {
      if (!isSymbol(token, '+')) return { kind: 'EXPRESSION', text };
      continue;
    }
    const decoded = token.kind === 'string' ? decodeStringLiteral(token.value) : undefined;
    if (decoded === undefined) return { kind: 'EXPRESSION', text };
    parts.push(decoded);
  }
  if (tokens.length === 0 || tokens.length % 2 === 0) return { kind: 'EXPRESSION', text };
  return { kind: 'STRING', value: parts.join('') };
}

function toElementValues(tokens: readonly JavaToken[], source: string): ElementValue[] {
  if (isSymbol(tokens[0], '{') && isSymbol(tokens[tokens.length - 1], '}')) {
    return splitTopLevel(tokens.slice(1, -1))
      .filter((part) => part.length > 0)
      .map((part) => toElementValue(part, source));
  }
  return tokens.length > 0 ? [toElementValue(tokens, source)] : [];
}

/**
 * Parses annotation arguments as captured by the source parser (the text between the
 * parentheses), e.g. `"/x"`, `{"/a", "/b"}` or `path = "/x", method = RequestMethod.POST`.
 * A lone value is stored under `value`, as Java defines it.
 */
export function parseAnnotationArguments(rawArguments: string | undefined): AnnotationArguments {
  const result = new Map<string, ElementValue[]>();
  if (!rawArguments || rawArguments.trim() === '') return result;

  const tokens = tokenizeJava(rawArguments);
  for (const part of splitTopLevel(tokens)) {
    const [name, equals] = part;
    const named = name?.kind === 'identifier' && isSymbol(equals, '=');
    const key = named ? name.value : 'value';
    const values = toElementValues(named ? part.slice(2) : part, rawArguments);
    result.set(key, [...(result.get(key) ?? []), ...values]);
  }
  return result;
}
