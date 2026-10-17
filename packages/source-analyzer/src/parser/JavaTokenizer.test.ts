import { describe, expect, it } from 'vitest';
import { tokenizeJava } from './JavaTokenizer.js';

const values = (source: string): string[] => tokenizeJava(source).map((t) => t.value);

describe('tokenizeJava', () => {
  it('splits identifiers, keywords and symbols with 1-based positions', () => {
    const tokens = tokenizeJava('package a.b;\n  import x.Y;');
    expect(tokens.map((t) => [t.kind, t.value, t.line, t.column])).toEqual([
      ['keyword', 'package', 1, 1],
      ['identifier', 'a', 1, 9],
      ['symbol', '.', 1, 10],
      ['identifier', 'b', 1, 11],
      ['symbol', ';', 1, 12],
      ['keyword', 'import', 2, 3],
      ['identifier', 'x', 2, 10],
      ['symbol', '.', 2, 11],
      ['identifier', 'Y', 2, 12],
      ['symbol', ';', 2, 13],
    ]);
  });

  it('drops line and block comments so their contents are never code', () => {
    expect(values('a // import evil.Foo;\n/* new Bad() */ b')).toEqual(['a', 'b']);
  });

  it('keeps string, char and text block literals as single tokens', () => {
    const tokens = tokenizeJava('f("import x.Y; // no", \'"\', """\n  new Z()\n  """);');
    expect(tokens.map((t) => t.kind)).toEqual([
      'identifier', 'symbol', 'string', 'symbol', 'char', 'symbol', 'string', 'symbol', 'symbol',
    ]);
    expect(tokens[2]?.value).toBe('"import x.Y; // no"');
  });

  it('handles escaped quotes inside strings', () => {
    expect(values('s = "a\\"b"; t')).toEqual(['s', '=', '"a\\"b"', ';', 't']);
  });

  it('tracks lines across multi-line text blocks and comments', () => {
    const tokens = tokenizeJava('x = """\nline\n""";\n/*\n*/\ny');
    expect(tokens.find((t) => t.value === 'y')?.line).toBe(6);
  });

  it('reads numbers including exponents and suffixes as one token', () => {
    expect(values('a = 1.5e-3f + 0x1Fl - 10_000;')).toEqual(['a', '=', '1.5e-3f', '+', '0x1Fl', '-', '10_000', ';']);
  });

  it('recognises multi-character symbols used by the parser', () => {
    expect(values('Foo::bar; x -> y; String... a')).toEqual([
      'Foo', '::', 'bar', ';', 'x', '->', 'y', ';', 'String', '...', 'a',
    ]);
  });

  it('keeps contextual keywords such as record and var as identifiers', () => {
    expect(tokenizeJava('record var').map((t) => t.kind)).toEqual(['identifier', 'identifier']);
  });

  it('does not throw on unterminated literals or comments', () => {
    expect(() => tokenizeJava('"open\nnext /* never closed')).not.toThrow();
    expect(values('"open\nnext')).toEqual(['"open', 'next']);
  });
});
