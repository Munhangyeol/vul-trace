import type { CycloneDxComponent } from './types.js';

/** Maven scope → CycloneDX component scope (CLAUDE.md §7 Phase 2). No dependencies are filtered out. */
export function mapMavenScopeToCycloneDx(
  scope: string,
): NonNullable<CycloneDxComponent['scope']> {
  if (scope === 'provided') return 'optional';
  if (scope === 'test') return 'excluded';
  return 'required'; // compile, runtime, system, and any unrecognized scope
}
