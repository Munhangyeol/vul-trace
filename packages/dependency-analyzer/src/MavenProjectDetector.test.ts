import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MavenProjectDetector } from './MavenProjectDetector.js';

describe('MavenProjectDetector', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vt-detector-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails with PROJECT_NOT_FOUND when the path does not exist', () => {
    const result = new MavenProjectDetector().detect(join(dir, 'missing'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('fails with PROJECT_NOT_FOUND when the path is a file, not a directory', () => {
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, '');
    const result = new MavenProjectDetector().detect(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('fails with UNSUPPORTED_PROJECT when pom.xml is missing', () => {
    const result = new MavenProjectDetector().detect(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_PROJECT');
  });

  it('detects a project with pom.xml and no warnings', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    const result = new MavenProjectDetector().detect(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pomPath).toBe(join(dir, 'pom.xml'));
      expect(result.value.warnings).toEqual([]);
    }
  });

  it('warns when .mvn/extensions.xml is present', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    mkdirSync(join(dir, '.mvn'));
    writeFileSync(join(dir, '.mvn', 'extensions.xml'), '<extensions/>');
    const result = new MavenProjectDetector().detect(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toHaveLength(1);
      expect(result.value.warnings[0]).toContain('.mvn/extensions.xml');
    }
  });

  it('warns when a Maven wrapper script is present', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    writeFileSync(join(dir, 'mvnw'), '#!/bin/sh');
    const result = new MavenProjectDetector().detect(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings.some((w) => w.includes('mvnw'))).toBe(true);
    }
  });
});
