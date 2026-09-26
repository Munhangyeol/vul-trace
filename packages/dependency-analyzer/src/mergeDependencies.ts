import type {
  DependencyCoordinate,
  ProjectDependency,
  UnresolvedDependency,
} from '@vulntrace/shared';
import { toMavenPurl } from './purl.js';
import type { DependencyTreeNode } from './tree/DependencyTreeParser.js';

export interface MergeDependenciesInput {
  pomFilePath: string;
  treeFilePath: string;
  pomResolved: DependencyCoordinate[];
  pomUnresolved: UnresolvedDependency[];
  treeNodes: DependencyTreeNode[];
}

export interface MergeDependenciesResult {
  dependencies: ProjectDependency[];
  unresolvedDependencies: UnresolvedDependency[];
  warnings: string[];
}

const key = (groupId: string, artifactId: string): string => `${groupId}:${artifactId}`;

/** Combines pom.xml and `dependency:tree` results, preferring the tree's resolved versions (CLAUDE.md §6.2). */
export function mergeDependencies(input: MergeDependenciesInput): MergeDependenciesResult {
  const { pomFilePath, treeFilePath, pomResolved, pomUnresolved, treeNodes } = input;
  const warnings: string[] = [];

  const treeByKey = new Map<string, DependencyTreeNode>();
  for (const node of treeNodes) {
    const k = key(node.groupId, node.artifactId);
    if (!treeByKey.has(k)) treeByKey.set(k, node); // first occurrence: the shallowest one seen
  }

  const dependencies: ProjectDependency[] = [];
  const consumedTreeKeys = new Set<string>();

  for (const coordinate of pomResolved) {
    const k = key(coordinate.groupId, coordinate.artifactId);
    const treeNode = treeByKey.get(k);

    if (!treeNode) {
      dependencies.push({ coordinate, source: { kind: 'pom.xml', filePath: pomFilePath } });
      continue;
    }

    consumedTreeKeys.add(k);
    if (treeNode.version !== coordinate.version) {
      warnings.push(
        `${k}: pom.xml declares version ${coordinate.version} but dependency:tree resolved ${treeNode.version}; using the tree value`,
      );
    }
    dependencies.push({
      coordinate: {
        ...coordinate,
        version: treeNode.version,
        purl: toMavenPurl({
          groupId: coordinate.groupId,
          artifactId: coordinate.artifactId,
          version: treeNode.version,
        }),
      },
      source: { kind: 'pom.xml', filePath: pomFilePath },
    });
  }

  const remainingUnresolved: UnresolvedDependency[] = [];
  for (const unresolved of pomUnresolved) {
    const k = key(unresolved.groupId, unresolved.artifactId);
    const treeNode = treeByKey.get(k);

    if (!treeNode) {
      remainingUnresolved.push(unresolved);
      continue;
    }

    consumedTreeKeys.add(k);
    dependencies.push({
      coordinate: {
        groupId: unresolved.groupId,
        artifactId: unresolved.artifactId,
        version: treeNode.version,
        scope: unresolved.scope,
        direct: true,
        purl: toMavenPurl({
          groupId: unresolved.groupId,
          artifactId: unresolved.artifactId,
          version: treeNode.version,
        }),
      },
      source: { kind: 'pom.xml', filePath: pomFilePath },
    });
  }

  for (const [k, node] of treeByKey) {
    if (consumedTreeKeys.has(k)) continue;
    dependencies.push({
      coordinate: {
        groupId: node.groupId,
        artifactId: node.artifactId,
        version: node.version,
        scope: node.scope,
        direct: false,
        purl: node.purl,
      },
      source: { kind: 'dependency-tree', filePath: treeFilePath, introducedBy: node.introducedBy },
    });
  }

  return { dependencies, unresolvedDependencies: remainingUnresolved, warnings };
}
