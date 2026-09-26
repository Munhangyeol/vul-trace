import { resolve, sep } from 'node:path';

/**
 * Restricts which local paths the API will register/scan (CLAUDE.md §4.2 — an exposed API
 * could otherwise scan any path readable by the server process).
 * Returns true when `scanRoot` is unset, or `targetPath` is it or nested inside it.
 */
export function isWithinScanRoot(targetPath: string, scanRoot: string | undefined): boolean {
  if (!scanRoot) return true;
  const resolvedRoot = resolve(scanRoot);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep);
}
