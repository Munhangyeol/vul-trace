import { describe, expect, it } from 'vitest';
import { toMavenPurl, toPackageCoordinate } from './purl.js';

describe('toMavenPurl', () => {
  it('builds a maven purl from GAV coordinates', () => {
    expect(
      toMavenPurl({ groupId: 'org.apache.commons', artifactId: 'commons-text', version: '1.9' }),
    ).toBe('pkg:maven/org.apache.commons/commons-text@1.9');
  });

  it('percent-encodes reserved characters', () => {
    expect(toMavenPurl({ groupId: 'com.example', artifactId: 'lib', version: '1.0+build@1' })).toBe(
      'pkg:maven/com.example/lib@1.0%2Bbuild%401',
    );
  });

  it('rejects empty coordinates', () => {
    expect(() => toMavenPurl({ groupId: '', artifactId: 'lib', version: '1.0' })).toThrow(
      /groupId/,
    );
  });
});

describe('toPackageCoordinate', () => {
  it('maps to the OSV-style Maven package name', () => {
    expect(
      toPackageCoordinate({
        groupId: 'org.apache.commons',
        artifactId: 'commons-text',
        version: '1.9',
        scope: 'compile',
        direct: true,
        purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
      }),
    ).toEqual({
      ecosystem: 'Maven',
      name: 'org.apache.commons:commons-text',
      version: '1.9',
      purl: 'pkg:maven/org.apache.commons/commons-text@1.9',
    });
  });
});
