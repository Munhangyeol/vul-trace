import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { SourceSet } from '@vulntrace/shared';
import type { JavaSourceFile } from '../types.js';

export interface JavaFileScanLimits {
  /** Stop collecting after this many files (repository contents are untrusted, CLAUDE.md §16). */
  maxFiles: number;
  maxDepth: number;
}

export const DEFAULT_SCAN_LIMITS: JavaFileScanLimits = { maxFiles: 20_000, maxDepth: 40 };

/** Build output, dependencies and VCS metadata — never application source. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'target']);

export interface JavaFileScanResult {
  files: JavaSourceFile[];
  warnings: string[];
}

/** `src/main/java` → MAIN, `src/test/java` → TEST, anywhere in the tree (multi-module aware). */
export function classifySourceSet(relativePath: string): SourceSet | undefined {
  const normalized = `/${relativePath}`;
  if (normalized.includes('/src/main/java/')) return 'MAIN';
  if (normalized.includes('/src/test/java/')) return 'TEST';
  return undefined;
}

/**
 * Finds `.java` files under Maven source roots. Symbolic links are never followed and hidden
 * directories are skipped so a hostile repository cannot point the scan outside its own tree.
 */
export function scanJavaFiles(
  projectPath: string,
  limits: JavaFileScanLimits = DEFAULT_SCAN_LIMITS,
): JavaFileScanResult {
  const files: JavaSourceFile[] = [];
  const warnings: string[] = [];
  let truncated = false;

  const walk = (relativeDir: string, depth: number): void => {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      warnings.push(`directory nesting deeper than ${limits.maxDepth} not scanned: ${relativeDir}`);
      return;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(join(projectPath, relativeDir), { withFileTypes: true });
    } catch (cause) {
      warnings.push(`cannot read directory ${relativeDir || '.'}: ${(cause as Error).message}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(relativePath, depth + 1);
        if (truncated) return;
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        const sourceSet = classifySourceSet(relativePath);
        if (!sourceSet) continue;
        if (files.length >= limits.maxFiles) {
          truncated = true;
          warnings.push(`more than ${limits.maxFiles} Java files; the rest were not analyzed`);
          return;
        }
        files.push({ filePath: relativePath, sourceSet });
      }
    }
  };

  walk('', 0);
  return { files, warnings };
}
