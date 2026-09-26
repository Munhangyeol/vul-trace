import { describe, expect, it } from 'vitest';
import type { DependencyCoordinate, UnresolvedDependency } from '@vulntrace/shared';
import { mergeDependencies } from './mergeDependencies.js';
import type { DependencyTreeNode } from './tree/DependencyTreeParser.js';
import { toMavenPurl } from './purl.js';

const coordinate = (overrides: Partial<DependencyCoordinate> = {}): DependencyCoordinate => ({
  groupId: 'org.example',
  artifactId: 'lib',
  version: '1.0.0',
  scope: 'compile',
  direct: true,
  purl: toMavenPurl({ groupId: 'org.example', artifactId: 'lib', version: '1.0.0' }),
  ...overrides,
});

const treeNode = (overrides: Partial<DependencyTreeNode> = {}): DependencyTreeNode => ({
  groupId: 'org.example',
  artifactId: 'lib',
  type: 'jar',
  version: '1.0.0',
  scope: 'compile',
  depth: 1,
  direct: true,
  purl: toMavenPurl({ groupId: 'org.example', artifactId: 'lib', version: '1.0.0' }),
  introducedBy: [],
  ...overrides,
});

describe('mergeDependencies', () => {
  it('keeps a pom-only dependency as direct with pom.xml source when there is no tree', () => {
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [coordinate()],
      pomUnresolved: [],
      treeNodes: [],
    });
    expect(result.dependencies).toEqual([
      { coordinate: coordinate(), source: { kind: 'pom.xml', filePath: 'pom.xml' } },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('prefers the tree version when a dependency is in both, and warns on mismatch', () => {
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [coordinate({ version: '1.0.0' })],
      pomUnresolved: [],
      treeNodes: [treeNode({ version: '1.2.0' })],
    });
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]?.coordinate.version).toBe('1.2.0');
    expect(result.dependencies[0]?.coordinate.direct).toBe(true);
    expect(result.dependencies[0]?.source).toEqual({ kind: 'pom.xml', filePath: 'pom.xml' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('org.example:lib');
  });

  it('does not warn when pom and tree agree on version', () => {
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [coordinate({ version: '1.0.0' })],
      pomUnresolved: [],
      treeNodes: [treeNode({ version: '1.0.0' })],
    });
    expect(result.warnings).toEqual([]);
  });

  it('marks a tree-only dependency as transitive with dependency-tree source and introducedBy', () => {
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [],
      pomUnresolved: [],
      treeNodes: [
        treeNode({
          groupId: 'org.transitive',
          artifactId: 'child',
          depth: 2,
          direct: false,
          purl: toMavenPurl({ groupId: 'org.transitive', artifactId: 'child', version: '1.0.0' }),
          introducedBy: ['pkg:maven/org.example/lib@1.0.0'],
        }),
      ],
    });
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]?.coordinate.direct).toBe(false);
    expect(result.dependencies[0]?.source).toEqual({
      kind: 'dependency-tree',
      filePath: 'tree.txt',
      introducedBy: ['pkg:maven/org.example/lib@1.0.0'],
    });
  });

  it('moves a pom-unresolved dependency into dependencies once the tree resolves its version', () => {
    const unresolved: UnresolvedDependency = {
      groupId: 'org.springframework.boot',
      artifactId: 'spring-boot-starter-web',
      scope: 'compile',
      reason: 'VERSION_MANAGED_BY_PARENT',
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    };
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [],
      pomUnresolved: [unresolved],
      treeNodes: [
        treeNode({
          groupId: 'org.springframework.boot',
          artifactId: 'spring-boot-starter-web',
          version: '3.5.6',
          purl: toMavenPurl({
            groupId: 'org.springframework.boot',
            artifactId: 'spring-boot-starter-web',
            version: '3.5.6',
          }),
        }),
      ],
    });
    expect(result.unresolvedDependencies).toEqual([]);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]?.coordinate).toMatchObject({
      artifactId: 'spring-boot-starter-web',
      version: '3.5.6',
      direct: true,
    });
    expect(result.dependencies[0]?.source).toEqual({ kind: 'pom.xml', filePath: 'pom.xml' });
  });

  it('keeps a dependency unresolved when the tree cannot resolve it either', () => {
    const unresolved: UnresolvedDependency = {
      groupId: 'org.example',
      artifactId: 'never-resolved',
      scope: 'compile',
      reason: 'VERSION_MANAGED_BY_PARENT',
      source: { kind: 'pom.xml', filePath: 'pom.xml' },
    };
    const result = mergeDependencies({
      pomFilePath: 'pom.xml',
      treeFilePath: 'tree.txt',
      pomResolved: [],
      pomUnresolved: [unresolved],
      treeNodes: [],
    });
    expect(result.unresolvedDependencies).toEqual([unresolved]);
    expect(result.dependencies).toEqual([]);
  });
});
