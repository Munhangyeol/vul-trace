import { describe, expect, it } from 'vitest';
import { looksLikeRepositoryUrl, parseGitHubRepositoryUrl, validateGitRef } from './githubUrl.js';

describe('parseGitHubRepositoryUrl', () => {
  it.each([
    ['https://github.com/spring-projects/spring-petclinic', 'spring-projects', 'spring-petclinic'],
    [
      'https://github.com/spring-projects/spring-petclinic.git',
      'spring-projects',
      'spring-petclinic',
    ],
    ['https://github.com/JoyChou93/java-sec-code/', 'JoyChou93', 'java-sec-code'],
    ['  https://github.com/a/b.c_d  ', 'a', 'b.c_d'],
  ])('accepts %s', (input, owner, repo) => {
    const result = parseGitHubRepositoryUrl(input);
    expect(result).toEqual({
      ok: true,
      value: { owner, repo, url: `https://github.com/${owner}/${repo}` },
    });
  });

  it.each([
    'http://github.com/a/b',
    'git@github.com:a/b.git',
    'ssh://git@github.com/a/b',
    'file:///C:/repos/b',
    'ext::sh -c touch% /tmp/pwned',
    'https://gitlab.com/a/b',
    'https://github.com.evil.example/a/b',
    'https://user:token@github.com/a/b',
    'https://github.com:443/a/b',
    'https://github.com/a/b?x=1',
    'https://github.com/a/b#main',
    'https://github.com/a/b/tree/main',
    'https://github.com/a',
    'https://github.com/-a/b',
    'https://github.com/a/..',
    'https://github.com/a/b c',
    '../local/path',
  ])('rejects %s', (input) => {
    const result = parseGitHubRepositoryUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_REPOSITORY_URL');
  });
});

describe('validateGitRef', () => {
  it.each(['main', 'v1.2.3', 'release/2026-11', 'feature_x'])('accepts %s', (ref) => {
    expect(validateGitRef(ref)).toEqual({ ok: true, value: ref });
  });

  it.each([
    '',
    '-upload-pack=touch x',
    '--depth=1',
    'a..b',
    'a b',
    'a;b',
    '/main',
    'main/',
    'a//b',
    'main.lock',
    'main.',
    '.hidden',
    'x/.hidden',
    'a~1',
    'a^',
    'a:b',
  ])('rejects %j', (ref) => {
    const result = validateGitRef(ref);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_REF');
  });
});

describe('looksLikeRepositoryUrl', () => {
  it('treats scheme-prefixed input as a URL and anything else as a path', () => {
    expect(looksLikeRepositoryUrl('https://github.com/a/b')).toBe(true);
    expect(looksLikeRepositoryUrl('file:///tmp/x')).toBe(true);
    expect(looksLikeRepositoryUrl('./fixtures/app')).toBe(false);
    expect(looksLikeRepositoryUrl(String.raw`C:\repos\app`)).toBe(false);
  });
});
