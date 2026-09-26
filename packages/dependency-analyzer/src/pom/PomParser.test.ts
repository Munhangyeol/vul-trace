import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PomParser } from './PomParser.js';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../../fixtures/${name}/pom.xml`, import.meta.url));

const readFixture = (name: string): string => readFileSync(fixturePath(name), 'utf-8');

describe('PomParser', () => {
  it.each([
    'spring-safe-app',
    'spring-vulnerable-unused',
    'spring-vulnerable-used',
    'spring-vulnerable-reachable',
  ])('parses the %s fixture pom.xml', (name) => {
    const result = new PomParser().parse(readFixture(name), fixturePath(name));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artifactId).toBe(name);
    expect(result.value.groupId).toBe('com.example');
    expect(result.value.version).toBe('0.0.1-SNAPSHOT');
    expect(result.value.parent).toEqual({
      groupId: 'org.springframework.boot',
      artifactId: 'spring-boot-starter-parent',
      version: '3.5.6',
      relativePath: '',
    });
    expect(result.value.properties['java.version']).toBe('17');
    expect(
      result.value.dependencies.some(
        (d) =>
          d.groupId === 'org.springframework.boot' && d.artifactId === 'spring-boot-starter-web',
      ),
    ).toBe(true);
  });

  it('defaults scope to compile and optional to false when absent', () => {
    const xml = `<project>
      <artifactId>demo</artifactId>
      <dependencies>
        <dependency>
          <groupId>org.example</groupId>
          <artifactId>lib</artifactId>
          <version>1.0.0</version>
        </dependency>
      </dependencies>
    </project>`;
    const result = new PomParser().parse(xml, 'pom.xml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependencies[0]).toEqual({
      groupId: 'org.example',
      artifactId: 'lib',
      version: '1.0.0',
      scope: 'compile',
      type: undefined,
      classifier: undefined,
      optional: false,
    });
  });

  it('parses optional and classifier when present', () => {
    const xml = `<project>
      <artifactId>demo</artifactId>
      <dependencies>
        <dependency>
          <groupId>org.example</groupId>
          <artifactId>lib</artifactId>
          <version>1.0.0</version>
          <scope>test</scope>
          <classifier>tests</classifier>
          <optional>true</optional>
        </dependency>
      </dependencies>
    </project>`;
    const result = new PomParser().parse(xml, 'pom.xml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependencies[0]).toMatchObject({
      scope: 'test',
      classifier: 'tests',
      optional: true,
    });
  });

  it('parses local dependencyManagement entries', () => {
    const xml = `<project>
      <artifactId>demo</artifactId>
      <dependencyManagement>
        <dependencies>
          <dependency>
            <groupId>org.example</groupId>
            <artifactId>lib</artifactId>
            <version>2.0.0</version>
          </dependency>
        </dependencies>
      </dependencyManagement>
    </project>`;
    const result = new PomParser().parse(xml, 'pom.xml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependencyManagement).toHaveLength(1);
    expect(result.value.dependencyManagement[0]?.version).toBe('2.0.0');
  });

  it('rejects malformed XML with PARSE_ERROR', () => {
    const result = new PomParser().parse('<project><artifactId>demo</artifactId>', 'pom.xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('rejects a pom missing <artifactId>', () => {
    const result = new PomParser().parse('<project><groupId>g</groupId></project>', 'pom.xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('rejects DOCTYPE declarations', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE project [<!ENTITY xxe "boom">]><project><artifactId>demo</artifactId></project>`;
    const result = new PomParser().parse(xml, 'pom.xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('rejects input larger than the size limit', () => {
    const huge = `<project><artifactId>${'a'.repeat(6 * 1024 * 1024)}</artifactId></project>`;
    const result = new PomParser().parse(huge, 'pom.xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });
});
