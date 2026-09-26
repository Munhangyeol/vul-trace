import { describe, expect, it } from 'vitest';
import type { RawPom, RawPomDependency } from './PomModel.js';
import { resolvePomDependencies } from './resolvePomDependencies.js';

const source = { kind: 'pom.xml' as const, filePath: 'pom.xml' };

const dependency = (overrides: Partial<RawPomDependency> = {}): RawPomDependency => ({
  groupId: 'org.example',
  artifactId: 'lib',
  scope: 'compile',
  optional: false,
  ...overrides,
});

const pom = (overrides: Partial<RawPom> = {}): RawPom => ({
  artifactId: 'demo',
  packaging: 'jar',
  properties: {},
  dependencies: [],
  dependencyManagement: [],
  modules: [],
  ...overrides,
});

describe('resolvePomDependencies', () => {
  it('substitutes ${project.version}', () => {
    const result = resolvePomDependencies(
      pom({ version: '1.2.3', dependencies: [dependency({ version: '${project.version}' })] }),
      source,
    );
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.version).toBe('1.2.3');
  });

  it('substitutes a user-defined property', () => {
    const result = resolvePomDependencies(
      pom({
        properties: { 'lib.version': '4.5.6' },
        dependencies: [dependency({ version: '${lib.version}' })],
      }),
      source,
    );
    expect(result.resolved[0]?.version).toBe('4.5.6');
  });

  it('substitutes a nested property reference', () => {
    const result = resolvePomDependencies(
      pom({
        properties: { a: '${b}', b: '7.0.0' },
        dependencies: [dependency({ version: '${a}' })],
      }),
      source,
    );
    expect(result.resolved[0]?.version).toBe('7.0.0');
  });

  it('flags a circular property reference as unresolved', () => {
    const result = resolvePomDependencies(
      pom({
        properties: { a: '${b}', b: '${a}' },
        dependencies: [dependency({ version: '${a}' })],
      }),
      source,
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toBe('UNRESOLVED_PROPERTY');
  });

  it('applies a local dependencyManagement version when the dependency omits one', () => {
    const result = resolvePomDependencies(
      pom({
        dependencyManagement: [dependency({ version: '9.9.9' })],
        dependencies: [dependency()],
      }),
      source,
    );
    expect(result.resolved[0]?.version).toBe('9.9.9');
  });

  it('marks a parent-managed version (no local version, has parent) as unresolved', () => {
    const result = resolvePomDependencies(
      pom({
        parent: { groupId: 'p', artifactId: 'p', version: '1.0.0' },
        dependencies: [dependency()],
      }),
      source,
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toBe('VERSION_MANAGED_BY_PARENT');
  });

  it('marks a version range as unresolved', () => {
    const result = resolvePomDependencies(
      pom({ dependencies: [dependency({ version: '[1.0,2.0)' })] }),
      source,
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toBe('VERSION_RANGE');
  });
});
