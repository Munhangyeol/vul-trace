import { toMavenPurl } from '../purl.js';

export interface DependencyTreeNode {
  groupId: string;
  artifactId: string;
  type: string;
  classifier?: string;
  version: string;
  scope: string;
  /** 1 = direct dependency of the project. */
  depth: number;
  direct: boolean;
  purl: string;
  /** Purl chain of ancestors that pulled this dependency in, nearest first. Empty when direct. */
  introducedBy: string[];
}

export interface DependencyTreeParseError {
  line: number;
  content: string;
}

export interface DependencyTreeParseResult {
  nodes: DependencyTreeNode[];
  errors: DependencyTreeParseError[];
}

// Each ancestor level is a fixed 3-character column: "|  " (continues) or "   " (no more siblings).
const LINE_PATTERN = /^((?:(?:\| {2})|(?: {3}))*)(\+- |\\- )(.+)$/;

interface ParsedCoordinate {
  groupId: string;
  artifactId: string;
  type: string;
  classifier?: string;
  version: string;
  scope: string;
}

function parseCoordinateText(text: string): ParsedCoordinate | undefined {
  const parts = text.split(':');
  if (parts.length === 5) {
    const [groupId, artifactId, type, version, scope] = parts;
    if (!groupId || !artifactId || !type || !version || !scope) return undefined;
    return { groupId, artifactId, type, version, scope };
  }
  if (parts.length === 6) {
    const [groupId, artifactId, type, classifier, version, scope] = parts;
    if (!groupId || !artifactId || !type || !classifier || !version || !scope) return undefined;
    return { groupId, artifactId, type, classifier, version, scope };
  }
  return undefined;
}

/** Parses `mvn dependency:tree -DoutputType=text` output. Unrecognized lines are reported, not dropped. */
export class DependencyTreeParser {
  parse(text: string): DependencyTreeParseResult {
    const nodes: DependencyTreeNode[] = [];
    const errors: DependencyTreeParseError[] = [];
    // Index 0 holds the depth-1 ancestor's purl, index 1 the depth-2 ancestor's, etc.
    const ancestorPurls: string[] = [];

    const rawLines = text.split(/\r\n|\r|\n/);

    rawLines.forEach((line, index) => {
      if (line.trim() === '') return;
      if (index === 0) return; // root project coordinate, not a dependency

      const lineNumber = index + 1;
      const match = LINE_PATTERN.exec(line);
      const coordinate = match ? parseCoordinateText(match[3] ?? '') : undefined;

      if (!match || !coordinate) {
        errors.push({ line: lineNumber, content: line });
        return;
      }

      const prefix = match[1] ?? '';
      const depth = prefix.length / 3 + 1;
      const purl = toMavenPurl(coordinate);
      const introducedBy = ancestorPurls.slice(0, depth - 1).reverse();

      nodes.push({ ...coordinate, depth, direct: depth === 1, purl, introducedBy });

      ancestorPurls[depth - 1] = purl;
      ancestorPurls.length = depth;
    });

    return { nodes, errors };
  }
}
