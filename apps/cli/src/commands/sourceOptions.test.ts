import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toScanTarget } from './sourceOptions.js';

describe('toScanTarget', () => {
  it('treats a path as a LOCAL target', () => {
    expect(toScanTarget('./fixtures/app', {})).toEqual({
      type: 'LOCAL',
      path: resolve('./fixtures/app'),
    });
  });

  it('treats a URL as a GIT target and forwards --ref', () => {
    expect(toScanTarget('https://github.com/a/b', { ref: 'v1' })).toEqual({
      type: 'GIT',
      repoUrl: 'https://github.com/a/b',
      ref: 'v1',
    });
    expect(toScanTarget('https://github.com/a/b', {})).toEqual({
      type: 'GIT',
      repoUrl: 'https://github.com/a/b',
    });
  });

  it('passes non-GitHub URLs through so the runner can reject them with a recorded reason', () => {
    expect(toScanTarget('file:///etc', {})).toEqual({ type: 'GIT', repoUrl: 'file:///etc' });
  });

  it('rejects --ref with a local path', () => {
    expect(toScanTarget('./app', { ref: 'main' })).toEqual({
      error: '--ref can only be used with a repository URL',
    });
  });
});
