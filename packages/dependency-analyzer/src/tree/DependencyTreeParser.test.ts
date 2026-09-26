import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DependencyTreeParser } from './DependencyTreeParser.js';

const readTestData = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../test-data/${name}`, import.meta.url)), 'utf-8');

describe('DependencyTreeParser', () => {
  it('parses nested dependencies with depth and introducedBy', () => {
    const result = new DependencyTreeParser().parse(readTestData('nested.tree.txt'));
    expect(result.errors).toEqual([]);
    expect(result.nodes).toHaveLength(5);

    const [starterWeb, starter, webmvc, commonsText, commonsLang3] = result.nodes;

    expect(starterWeb).toMatchObject({
      artifactId: 'spring-boot-starter-web',
      depth: 1,
      direct: true,
      introducedBy: [],
    });
    expect(starter).toMatchObject({
      artifactId: 'spring-boot-starter',
      depth: 2,
      direct: false,
      introducedBy: [starterWeb?.purl],
    });
    expect(webmvc).toMatchObject({
      artifactId: 'spring-webmvc',
      depth: 2,
      introducedBy: [starterWeb?.purl],
    });
    expect(commonsText).toMatchObject({
      artifactId: 'commons-text',
      depth: 1,
      direct: true,
      introducedBy: [],
    });
    expect(commonsLang3).toMatchObject({
      artifactId: 'commons-lang3',
      depth: 2,
      introducedBy: [commonsText?.purl],
    });
  });

  it('parses a classifier coordinate (g:a:type:classifier:v:scope)', () => {
    const result = new DependencyTreeParser().parse(readTestData('classifier.tree.txt'));
    expect(result.errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      groupId: 'org.example',
      artifactId: 'lib',
      type: 'test-jar',
      classifier: 'tests',
      version: '2.0.0',
      scope: 'test',
      depth: 1,
    });
  });

  it('reports unrecognized lines with their line number instead of dropping them', () => {
    const result = new DependencyTreeParser().parse(readTestData('unrecognized-line.tree.txt'));
    expect(result.nodes).toHaveLength(2);
    expect(result.errors).toEqual([
      { line: 3, content: '+- this line does not match the expected format' },
    ]);
  });

  it('returns no nodes and no errors for empty input', () => {
    const result = new DependencyTreeParser().parse('');
    expect(result.nodes).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const text = ['com.example:demo:jar:1.0.0', '+- org.example:lib:jar:1.0.0:compile'].join(
      '\r\n',
    );
    const result = new DependencyTreeParser().parse(text);
    expect(result.errors).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ artifactId: 'lib', depth: 1 });
  });
});
