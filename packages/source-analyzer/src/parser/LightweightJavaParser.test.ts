import { describe, expect, it } from 'vitest';
import { LightweightJavaParser } from './LightweightJavaParser.js';

const parse = (source: string) => new LightweightJavaParser().parse('src/main/java/demo/A.java', source);

describe('LightweightJavaParser — structure', () => {
  it('reads package, regular, static and wildcard imports with their lines', () => {
    const result = parse(
      [
        'package com.example.demo;',
        '',
        'import org.apache.commons.text.StringSubstitutor;',
        'import static org.apache.commons.text.StringSubstitutor.createInterpolator;',
        'import org.apache.commons.text.lookup.*;',
        'class A {}',
      ].join('\n'),
    );

    expect(result.packageName).toBe('com.example.demo');
    expect(result.imports.map((i) => [i.name, i.isStatic, i.isWildcard, i.location.line])).toEqual([
      ['org.apache.commons.text.StringSubstitutor', false, false, 3],
      ['org.apache.commons.text.StringSubstitutor.createInterpolator', true, false, 4],
      ['org.apache.commons.text.lookup', false, true, 5],
    ]);
  });

  it('ignores imports that only appear in comments or strings', () => {
    const result = parse('// import a.B;\n/* import c.D; */\nclass A { String s = "import e.F;"; }');
    expect(result.imports).toEqual([]);
  });

  it('detects types, nested types, methods, constructors and their annotations', () => {
    const result = parse(
      [
        'package demo;',
        '@RestController',
        '@RequestMapping("/api/templates")',
        'public class TemplateController {',
        '  private final TemplateService service;',
        '  public TemplateController(TemplateService service) { this.service = service; }',
        '  @PostMapping(value = "/render", consumes = "text/plain")',
        '  public String render(@RequestBody String template) throws Exception {',
        '    if (template.isEmpty()) { return helper(template); }',
        '    return service.render(template);',
        '  }',
        '  private String helper(String s) { return s; }',
        '  static class Inner { void run() {} }',
        '}',
      ].join('\n'),
    );

    const [outer, inner] = result.types;
    expect(outer).toMatchObject({
      name: 'TemplateController',
      qualifiedName: 'demo.TemplateController',
      kind: 'class',
      location: { line: 4 },
    });
    expect(outer?.annotations).toEqual([
      expect.objectContaining({ name: 'RestController', location: expect.objectContaining({ line: 2 }) }),
      expect.objectContaining({ name: 'RequestMapping', rawArguments: '"/api/templates"' }),
    ]);
    expect(outer?.methods.map((m) => [m.name, m.location.line])).toEqual([
      ['TemplateController', 6],
      ['render', 8],
      ['helper', 12],
    ]);
    expect(outer?.methods[1]?.annotations).toEqual([
      expect.objectContaining({
        name: 'PostMapping',
        rawArguments: 'value = "/render", consumes = "text/plain"',
      }),
    ]);
    expect(inner).toMatchObject({ name: 'Inner', qualifiedName: 'demo.TemplateController.Inner' });
    expect(inner?.methods.map((m) => m.name)).toEqual(['run']);
  });

  it('does not treat enum constants, field initializers or Foo.class as declarations', () => {
    const result = parse(
      [
        'enum Color {',
        '  RED("r"), GREEN("g");',
        '  private final String code;',
        '  Color(String code) { this.code = code; }',
        '  static final Class<?> TYPE = Color.class;',
        '  private int size = compute();',
        '  String code() { return code; }',
        '}',
      ].join('\n'),
    );

    expect(result.types.map((t) => [t.name, t.kind])).toEqual([['Color', 'enum']]);
    expect(result.types[0]?.methods.map((m) => m.name)).toEqual(['Color', 'code']);
  });

  it('detects records, interfaces and annotation types', () => {
    const result = parse(
      [
        'record Point(int x, int y) { int sum() { return x + y; } }',
        'interface Repo { void save(String s); }',
        '@interface Marker { String value() default ""; }',
      ].join('\n'),
    );

    expect(result.types.map((t) => [t.name, t.kind, t.methods.map((m) => m.name)])).toEqual([
      ['Point', 'record', ['sum']],
      ['Repo', 'interface', ['save']],
      ['Marker', 'annotation', ['value']],
    ]);
  });
});

describe('LightweightJavaParser — references', () => {
  const body = (code: string) => parse(`package demo;\nclass A {\n${code}\n}`);

  it('records object creations, including qualified and generic types', () => {
    const result = body(
      'void m() { Object a = new StringSubstitutor(map); Object b = new org.x.Foo<String>(); Runnable r = Bar::new; }',
    );
    expect(result.objectCreations.map((c) => c.typeName)).toEqual(['StringSubstitutor', 'org.x.Foo', 'Bar']);
  });

  it('records invocations with their qualifier and whether the receiver is an expression', () => {
    const result = body(
      [
        'String m(String t) {',
        '  StringSubstitutor s = StringSubstitutor.createInterpolator();',
        '  createInterpolator();',
        '  this.service.render(t);',
        '  return s.replace(t).trim();',
        '}',
      ].join('\n'),
    );

    expect(result.invocations.map((i) => [i.qualifier, i.name, i.chained, i.location.line])).toEqual([
      ['StringSubstitutor', 'createInterpolator', false, 4],
      [undefined, 'createInterpolator', false, 5],
      ['this.service', 'render', false, 6],
      ['s', 'replace', false, 7],
      [undefined, 'trim', true, 7],
    ]);
  });

  it('records method references as METHOD_REFERENCE invocations', () => {
    const result = body('void m() { list.forEach(StringSubstitutor::replace); }');
    expect(result.invocations).toContainEqual(
      expect.objectContaining({ qualifier: 'StringSubstitutor', name: 'replace', kind: 'METHOD_REFERENCE' }),
    );
  });

  it('records field, parameter, local, generic, array, var and pattern declarations', () => {
    const result = body(
      [
        'private final TemplateService service;',
        'void m(StringSubstitutor sub, String... args) {',
        '  Map<String, List<Foo>> map = null;',
        '  Foo[] arr = null;',
        '  var created = new Bar(1);',
        '  for (Baz z : items) {}',
        '  if (o instanceof Qux q) {}',
        '}',
      ].join('\n'),
    );

    expect(result.variables.map((v) => [v.typeName, v.name])).toEqual([
      ['TemplateService', 'service'],
      ['StringSubstitutor', 'sub'],
      ['String', 'args'],
      ['Map', 'map'],
      ['Foo', 'arr'],
      ['Bar', 'created'],
      ['Baz', 'z'],
      ['Qux', 'q'],
    ]);
  });

  it('does not record method declaration names as invocations', () => {
    const result = body('String render(String t) { return t; }');
    expect(result.invocations).toEqual([]);
  });

  it('records dotted names that are not calls, e.g. package-qualified class literals', () => {
    const result = body('Class<?> c = org.apache.commons.text.StringSubstitutor.class;');
    expect(result.nameReferences.map((r) => r.name)).toEqual(['org.apache.commons.text.StringSubstitutor']);
  });

  it('ignores code inside comments and strings', () => {
    const result = body('void m() { String s = "new Foo()"; /* Bar.baz(); */ }');
    expect(result.objectCreations).toEqual([]);
    expect(result.invocations).toEqual([]);
  });
});

describe('LightweightJavaParser — members for call resolution (Phase 6)', () => {
  const source = [
    'package com.example;', // 1
    'public class OrderController extends BaseController implements Api, Other<String> {', // 2
    '  private final OrderService orderService;', // 3
    '  private Map<String, List<Item>> cache = new HashMap<>();', // 4
    '  public OrderController(OrderService orderService) {', // 5
    '    this.orderService = orderService;', // 6
    '  }', // 7
    '  public String place(@RequestBody final Order order, int[] counts, String... tags) {', // 8
    '    Runnable r = () -> audit(order);', // 9
    '    return orderService.place(order, counts.length);', // 10
    '  }', // 11
    '  abstract void hook();', // 12
    '  static class Inner { void x() { helper(); } }', // 13
    '}', // 14
  ].join('\n');
  const result = parse(source);
  const outer = result.types.find((t) => t.name === 'OrderController');
  const inner = result.types.find((t) => t.name === 'Inner');

  it('reads extends / implements without type arguments', () => {
    expect(outer?.extendsTypes).toEqual(['BaseController']);
    expect(outer?.implementsTypes).toEqual(['Api', 'Other']);
    expect(inner?.extendsTypes).toEqual([]);
  });

  it('records member-level fields only', () => {
    expect(outer?.fields.map((f) => [f.typeName, f.name, f.location.line])).toEqual([
      ['OrderService', 'orderService', 3],
      ['Map', 'cache', 4],
    ]);
  });

  it('records constructors, parameters, bodies and ranges', () => {
    expect(outer?.methods.map((m) => [m.name, m.isConstructor, m.hasBody, m.range.start.line, m.range.end.line])).toEqual([
      ['OrderController', true, true, 5, 7],
      ['place', false, true, 8, 11],
      ['hook', false, false, 12, 12],
    ]);
    expect(outer?.methods[1]?.parameters.map((p) => [p.typeName, p.name])).toEqual([
      ['Order', 'order'],
      ['int', 'counts'],
      ['String', 'tags'],
    ]);
    expect(outer?.range).toMatchObject({ start: { line: 2 }, end: { line: 14 } });
  });

  it('gives references the method that contains them, lambdas included', () => {
    const scopeOf = (name: string) => result.invocations.find((i) => i.name === name)?.scope;
    expect(scopeOf('audit')).toEqual({ typeQualifiedName: 'com.example.OrderController', methodIndex: 1 });
    expect(scopeOf('place')).toEqual({ typeQualifiedName: 'com.example.OrderController', methodIndex: 1 });
    expect(scopeOf('helper')).toEqual({ typeQualifiedName: 'com.example.OrderController.Inner', methodIndex: 0 });
    expect(result.objectCreations.find((c) => c.typeName === 'HashMap')?.scope).toEqual({
      typeQualifiedName: 'com.example.OrderController',
    });
    expect(result.variables.find((v) => v.name === 'order')?.scope?.methodIndex).toBe(1);
  });

  it('counts top-level call arguments', () => {
    const argsOf = (name: string) => result.invocations.find((i) => i.name === name)?.argumentCount;
    expect(argsOf('place')).toBe(2);
    expect(argsOf('helper')).toBe(0);
    expect(argsOf('audit')).toBe(1);
  });
});
