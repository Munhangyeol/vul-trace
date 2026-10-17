import { describe, expect, it } from 'vitest';
import type { SourceSet } from '@vulntrace/shared';
import { LightweightJavaParser } from '../parser/LightweightJavaParser.js';
import type { JavaAnalysisResult } from '../types.js';
import { matchDependencyUsages } from './UsageMatcher.js';
import type { DependencyRef } from './UsageMatcher.js';

const COMMONS_TEXT: DependencyRef = {
  groupId: 'org.apache.commons',
  artifactId: 'commons-text',
  purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
};
const COMMONS_LANG3: DependencyRef = {
  groupId: 'org.apache.commons',
  artifactId: 'commons-lang3',
  purl: 'pkg:maven/org.apache.commons/commons-lang3@3.12.0',
};

function analysis(files: Array<{ path: string; source: string; sourceSet?: SourceSet }>): JavaAnalysisResult {
  const parser = new LightweightJavaParser();
  return {
    projectPath: '/project',
    files: files.map(({ path, source, sourceSet }) => ({
      ...parser.parse(path, source),
      sourceSet: sourceSet ?? 'MAIN',
    })),
    skippedFiles: [],
    warnings: [],
  };
}

const usagesOf = (result: ReturnType<typeof matchDependencyUsages>, purl: string) =>
  (result.find((r) => r.purl === purl)?.usages ?? []).map(
    (u) => `${u.kind} ${u.symbol} @${u.evidence.location.line}`,
  );

describe('matchDependencyUsages', () => {
  it('finds import, static call and variable call evidence with snippets', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/TemplateService.java',
          source: [
            'package demo;',
            'import org.apache.commons.text.StringSubstitutor;',
            'class TemplateService {',
            '  String render(String t) {',
            '    StringSubstitutor interpolator = StringSubstitutor.createInterpolator();',
            '    return interpolator.replace(t);',
            '  }',
            '}',
          ].join('\n'),
        },
      ]),
      [COMMONS_TEXT],
    );

    expect(usagesOf(result, COMMONS_TEXT.purl)).toEqual([
      'IMPORT org.apache.commons.text.StringSubstitutor @2',
      'METHOD_CALL org.apache.commons.text.StringSubstitutor#createInterpolator @5',
      'METHOD_CALL org.apache.commons.text.StringSubstitutor#replace @6',
    ]);
    const call = result[0]?.usages[1];
    expect(call).toMatchObject({
      sourceSet: 'MAIN',
      dependencyPurl: COMMONS_TEXT.purl,
      evidence: {
        location: { filePath: 'src/main/java/demo/TemplateService.java', line: 5 },
        snippet: 'StringSubstitutor interpolator = StringSubstitutor.createInterpolator();',
      },
    });
    expect(result[0]?.packageMapping).toEqual({ packages: ['org.apache.commons.text'], basis: 'CURATED' });
  });

  it('returns no usages when the dependency is declared but never referenced', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/Hello.java',
          source: 'package demo;\nimport org.springframework.web.bind.annotation.RestController;\n@RestController class Hello {}',
        },
      ]),
      [COMMONS_TEXT],
    );
    expect(result).toEqual([
      { purl: COMMONS_TEXT.purl, packageMapping: expect.anything(), usages: [] },
    ]);
  });

  it('resolves static imports, wildcard imports and fully qualified names', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/A.java',
          source: [
            'package demo;',
            'import static org.apache.commons.text.StringSubstitutor.createInterpolator;',
            'import org.apache.commons.text.lookup.*;',
            'class A {',
            '  void m() {',
            '    createInterpolator();',
            '    StringLookupFactory.builder();',
            '    new org.apache.commons.text.StringSubstitutor();',
            '    Object c = org.apache.commons.text.WordUtils.class;',
            '  }',
            '}',
          ].join('\n'),
        },
      ]),
      [COMMONS_TEXT],
    );

    expect(usagesOf(result, COMMONS_TEXT.purl)).toEqual([
      'IMPORT org.apache.commons.text.StringSubstitutor.createInterpolator @2',
      'IMPORT org.apache.commons.text.lookup.* @3',
      'METHOD_CALL org.apache.commons.text.StringSubstitutor#createInterpolator @6',
      'METHOD_CALL org.apache.commons.text.lookup.StringLookupFactory#builder @7',
      'OBJECT_CONSTRUCTION org.apache.commons.text.StringSubstitutor @8',
      'PACKAGE_REFERENCE org.apache.commons.text.WordUtils @9',
    ]);
  });

  it('does not attribute project types to a wildcard-imported dependency package', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/A.java',
          source: 'package demo;\nimport org.apache.commons.text.*;\nclass A { void m() { new Helper(); Helper.run(); } }',
        },
        { path: 'src/main/java/demo/Helper.java', source: 'package demo;\nclass Helper { static void run() {} }' },
      ]),
      [COMMONS_TEXT],
    );
    expect(usagesOf(result, COMMONS_TEXT.purl)).toEqual(['IMPORT org.apache.commons.text.* @2']);
  });

  it('uses the longest package prefix when dependencies share a groupId', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/A.java',
          source: 'package demo;\nimport org.apache.commons.lang3.StringUtils;\nclass A {}',
        },
      ]),
      [COMMONS_TEXT, COMMONS_LANG3],
    );
    expect(usagesOf(result, COMMONS_TEXT.purl)).toEqual([]);
    expect(usagesOf(result, COMMONS_LANG3.purl)).toEqual(['IMPORT org.apache.commons.lang3.StringUtils @2']);
  });

  it('falls back to the groupId as package prefix and records that basis', () => {
    const dep: DependencyRef = { groupId: 'io.jsonwebtoken', artifactId: 'jjwt-api', purl: 'pkg:maven/io.jsonwebtoken/jjwt-api@0.11.5' };
    const result = matchDependencyUsages(
      analysis([{ path: 'src/main/java/demo/A.java', source: 'package demo;\nimport io.jsonwebtoken.Jwts;\nclass A {}' }]),
      [dep],
    );
    expect(result[0]?.packageMapping).toEqual({ packages: ['io.jsonwebtoken'], basis: 'GROUP_ID' });
    expect(usagesOf(result, dep.purl)).toEqual(['IMPORT io.jsonwebtoken.Jwts @2']);
  });

  it('skips calls whose receiver type is unknown (chained or conflicting variable types)', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/main/java/demo/A.java',
          source: [
            'package demo;',
            'import org.apache.commons.text.StringSubstitutor;',
            'class A {',
            '  void a(StringSubstitutor x) { x.replace("a"); }',
            '  void b(String x) { x.trim(); factory().replace("b"); }',
            '}',
          ].join('\n'),
        },
      ]),
      [COMMONS_TEXT],
    );
    // `x` is declared with two different types in this file, so neither call is attributed.
    expect(usagesOf(result, COMMONS_TEXT.purl)).toEqual(['IMPORT org.apache.commons.text.StringSubstitutor @2']);
  });

  it('keeps the source set of each usage', () => {
    const result = matchDependencyUsages(
      analysis([
        {
          path: 'src/test/java/demo/ATest.java',
          source: 'package demo;\nimport org.apache.commons.text.StringSubstitutor;\nclass ATest {}',
          sourceSet: 'TEST',
        },
      ]),
      [COMMONS_TEXT],
    );
    expect(result[0]?.usages.map((u) => u.sourceSet)).toEqual(['TEST']);
  });
});
