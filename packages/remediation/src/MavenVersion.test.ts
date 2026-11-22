import { describe, expect, it } from 'vitest';
import { compareVersionStrings, majorVersion, parseMavenVersion } from './MavenVersion.js';

/** Asserts a strictly increasing sequence, pairwise both ways. */
function expectAscending(versions: string[]): void {
  for (let i = 0; i < versions.length; i++) {
    for (let j = i + 1; j < versions.length; j++) {
      const a = versions[i] as string;
      const b = versions[j] as string;
      expect(compareVersionStrings(a, b), `${a} < ${b}`).toBeLessThan(0);
      expect(compareVersionStrings(b, a), `${b} > ${a}`).toBeGreaterThan(0);
    }
  }
}

describe('Maven version ordering', () => {
  it('compares numeric items as numbers, including four-part versions from OSV', () => {
    expectAscending(['2.6.7.4', '2.9.8', '2.9.10', '2.9.10.4', '2.9.10.7', '2.9.10.10', '2.10.5.1', '2.12.6.1', '2.13.2.1']);
    expectAscending(['1.2.24', '1.2.31', '1.2.48', '1.2.83']);
    expectAscending(['1.9', '1.10.0']);
  });

  it('orders qualifiers like Maven, with aliases and short forms', () => {
    expectAscending(['1.0-alpha-1', '1.0-beta', '1.0-milestone-1', '1.0-rc1', '1.0-snapshot', '1.0', '1.0-sp1']);
    expect(compareVersionStrings('1.0-a1', '1.0-alpha-1')).toBe(0);
    expect(compareVersionStrings('1.0-cr1', '1.0-rc1')).toBe(0);
    expect(compareVersionStrings('1.0-ga', '1.0')).toBe(0);
    expect(compareVersionStrings('1.0.Final', '1.0')).toBe(0);
    expect(compareVersionStrings('1.0-RC1', '1.0-rc1')).toBe(0);
  });

  it('treats trailing zeros as equal and numbers as newer than qualifiers', () => {
    expect(compareVersionStrings('1.0', '1')).toBe(0);
    expect(compareVersionStrings('1.0.0', '1')).toBe(0);
    expectAscending(['1-alpha', '1', '1-1', '1.1']);
    // Unknown qualifiers sort after the known ones (and after release).
    expectAscending(['32.1.3', '32.1.3-jre', '33.7.2']);
  });

  it('refuses strings that are not versions instead of guessing', () => {
    expect(parseMavenVersion('[2.0,3.0)')).toBeUndefined();
    expect(parseMavenVersion('')).toBeUndefined();
    expect(parseMavenVersion('1.0 beta')).toBeUndefined();
    expect(compareVersionStrings('1.0', '${version}')).toBeUndefined();
  });

  it('exposes the major version', () => {
    expect(majorVersion(parseMavenVersion('2.9.10.4')!)).toBe(2n);
    expect(majorVersion(parseMavenVersion('alpha')!)).toBeUndefined();
  });
});
