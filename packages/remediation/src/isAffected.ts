import type { AffectedRange } from '@vulntrace/shared';
import { compareMavenVersions, parseMavenVersion } from './MavenVersion.js';
import type { MavenVersion } from './MavenVersion.js';

/**
 * - `AFFECTED`: a range or the explicit version list covers the version.
 * - `NOT_AFFECTED`: every ECOSYSTEM range was evaluated and none covers it.
 * - `UNKNOWN`: a version could not be compared, or a range type other than ECOSYSTEM is involved.
 */
export type AffectedStatus = 'AFFECTED' | 'NOT_AFFECTED' | 'UNKNOWN';

export interface AffectedEvidence {
  affectedRanges: readonly AffectedRange[];
  affectedVersions: readonly string[];
}

type Event = { kind: 'introduced' | 'fixed' | 'last_affected' | 'limit'; version: MavenVersion | 'ZERO' };

/**
 * OSV schema evaluation of `affected[].ranges` (type ECOSYSTEM, Maven ordering) and `versions`
 * for one version (Phase 8 D3). Events are sorted by version and replayed: `introduced` opens a
 * vulnerable span, `fixed` closes it at that version, `last_affected` closes it after that
 * version, and `limit` caps the range.
 */
export function isAffected(version: string, evidence: AffectedEvidence): AffectedStatus {
  if (evidence.affectedVersions.includes(version)) return 'AFFECTED';
  const target = parseMavenVersion(version);
  if (!target) return 'UNKNOWN';
  if (evidence.affectedRanges.length === 0) return evidence.affectedVersions.length > 0 ? 'NOT_AFFECTED' : 'UNKNOWN';

  let unknown = false;
  for (const range of evidence.affectedRanges) {
    if (range.type !== 'ECOSYSTEM') {
      unknown = true;
      continue;
    }
    const result = evaluateRange(target, range);
    if (result === 'AFFECTED') return 'AFFECTED';
    if (result === 'UNKNOWN') unknown = true;
  }
  return unknown ? 'UNKNOWN' : 'NOT_AFFECTED';
}

function evaluateRange(target: MavenVersion, range: AffectedRange): AffectedStatus {
  const events: Event[] = [];
  for (const e of range.events) {
    const add = (kind: Event['kind'], value: string | undefined): boolean => {
      if (value === undefined) return true;
      if (kind === 'introduced' && value === '0') {
        events.push({ kind, version: 'ZERO' });
        return true;
      }
      const parsed = parseMavenVersion(value);
      if (!parsed) return false;
      events.push({ kind, version: parsed });
      return true;
    };
    if (
      !add('introduced', e.introduced) ||
      !add('fixed', e.fixed) ||
      !add('last_affected', e.lastAffected) ||
      !add('limit', e.limit)
    ) {
      return 'UNKNOWN';
    }
  }

  const compare = (a: Event['version'], b: MavenVersion): number =>
    a === 'ZERO' ? -1 : compareMavenVersions(a, b);
  events.sort((a, b) => {
    if (a.version === 'ZERO') return b.version === 'ZERO' ? 0 : -1;
    if (b.version === 'ZERO') return 1;
    return compareMavenVersions(a.version, b.version);
  });

  const limits = events.filter((e) => e.kind === 'limit');
  if (limits.length > 0 && limits.every((l) => compare(l.version, target) <= 0)) return 'NOT_AFFECTED';

  let vulnerable = false;
  for (const event of events) {
    const order = compare(event.version, target); // event version relative to target
    if (event.kind === 'introduced' && order <= 0) vulnerable = true;
    else if (event.kind === 'fixed' && order <= 0) vulnerable = false;
    else if (event.kind === 'last_affected' && order < 0) vulnerable = false;
  }
  return vulnerable ? 'AFFECTED' : 'NOT_AFFECTED';
}
