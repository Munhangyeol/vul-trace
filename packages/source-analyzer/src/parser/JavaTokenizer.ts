export type JavaTokenKind = 'identifier' | 'keyword' | 'symbol' | 'string' | 'char' | 'number';

export interface JavaToken {
  kind: JavaTokenKind;
  value: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Offset of the first character in the source. */
  start: number;
  /** Offset just past the last character. */
  end: number;
}

/**
 * Reserved keywords plus the literals `true`/`false`/`null`. Contextual keywords such as
 * `record`, `var`, `yield`, `sealed` stay identifiers so they can still be used as names.
 */
const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null',
]);

const MULTI_CHAR_SYMBOLS = ['...', '::', '->'];

const isIdentifierStart = (ch: string): boolean => /[\p{L}_$]/u.test(ch);
const isIdentifierPart = (ch: string): boolean => /[\p{L}\p{N}_$]/u.test(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Splits Java source into tokens, dropping whitespace and comments. Comments, string literals,
 * text blocks and char literals are recognised here so their contents can never be mistaken for
 * code (e.g. an `import` inside a comment). Malformed input never throws: an unterminated literal
 * or comment simply runs to the end of the line / file.
 */
export function tokenizeJava(source: string): JavaToken[] {
  const tokens: JavaToken[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  const advanceTo = (target: number): void => {
    for (let i = pos; i < target; i++) {
      if (source[i] === '\n') {
        line += 1;
        lineStart = i + 1;
      }
    }
    pos = target;
  };

  const push = (kind: JavaTokenKind, start: number, end: number, value = source.slice(start, end)): void => {
    tokens.push({ kind, value, line, column: start - lineStart + 1, start, end });
  };

  /** Index just past a quoted literal starting at `start` (escape-aware, stops at end of line). */
  const scanQuoted = (start: number, quote: string): number => {
    let i = start + 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') i += 2;
      else if (ch === quote) return i + 1;
      else if (ch === '\n') return i;
      else i += 1;
    }
    return source.length;
  };

  while (pos < source.length) {
    const ch = source[pos] as string;
    const next = source[pos + 1];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f') {
      advanceTo(pos + 1);
      continue;
    }

    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', pos);
      advanceTo(eol === -1 ? source.length : eol);
      continue;
    }

    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', pos + 2);
      advanceTo(close === -1 ? source.length : close + 2);
      continue;
    }

    if (ch === '"' && source.startsWith('"""', pos)) {
      let i = pos + 3;
      let end = source.length;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source.startsWith('"""', i)) {
          end = i + 3;
          break;
        } else i += 1;
      }
      push('string', pos, end);
      advanceTo(end);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = scanQuoted(pos, ch);
      push(ch === '"' ? 'string' : 'char', pos, end);
      advanceTo(end);
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(next))) {
      const isHex = ch === '0' && (next === 'x' || next === 'X');
      let i = pos + 1;
      while (i < source.length) {
        const c = source[i] as string;
        const prev = source[i - 1] as string;
        const isExponentSign =
          (c === '+' || c === '-') && (isHex ? /[pP]/.test(prev) : /[eE]/.test(prev));
        if (/[0-9A-Za-z_.]/.test(c) || isExponentSign) i += 1;
        else break;
      }
      push('number', pos, i);
      advanceTo(i);
      continue;
    }

    if (isIdentifierStart(ch)) {
      let i = pos + 1;
      while (i < source.length && isIdentifierPart(source[i] as string)) i += 1;
      const word = source.slice(pos, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'identifier', pos, i, word);
      advanceTo(i);
      continue;
    }

    const multi = MULTI_CHAR_SYMBOLS.find((s) => source.startsWith(s, pos));
    const end = pos + (multi?.length ?? 1);
    push('symbol', pos, end);
    advanceTo(end);
  }

  return tokens;
}
