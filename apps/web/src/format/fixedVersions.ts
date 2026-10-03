/** Never fabricates a fix — says so explicitly when OSV reported none (CLAUDE.md §6.2). */
export function formatFixedVersions(fixedVersions: string[]): string {
  return fixedVersions.length > 0 ? fixedVersions.join(', ') : 'no fix';
}
