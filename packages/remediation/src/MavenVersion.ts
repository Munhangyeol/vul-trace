/**
 * Maven version ordering (Phase 8 D2) — the subset of Maven's `ComparableVersion` needed to rank
 * OSV fixed versions: `.`/`-` separators and digit↔letter transitions, numeric items compared as
 * numbers, qualifiers ordered `alpha < beta < milestone < rc (= cr) < snapshot < release < sp`,
 * unknown qualifiers after `sp` (lexically), and trailing "null" items ignored (`1.0` = `1`).
 *
 * No external library (CLAUDE.md §21). Strings that do not look like a version are rejected
 * rather than guessed at, so callers can report "cannot compare" instead of a wrong answer.
 */

type Item = IntItem | StringItem | ListItem;

interface IntItem {
  kind: 'int';
  value: bigint;
}

interface StringItem {
  kind: 'string';
  value: string;
}

interface ListItem {
  kind: 'list';
  items: Item[];
}

const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const ALIASES: Readonly<Record<string, string>> = { ga: '', final: '', release: '', cr: 'rc' };
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

export interface MavenVersion {
  /** The version as given. */
  readonly raw: string;
  readonly root: ListItem;
}

/** Parses a Maven version, or returns undefined when the string does not look like one. */
export function parseMavenVersion(raw: string): MavenVersion | undefined {
  const text = raw.trim();
  if (!VERSION_PATTERN.test(text)) return undefined;
  return { raw, root: parseItems(text.toLowerCase()) };
}

/** Negative when a < b, 0 when equal, positive when a > b — Maven ordering. */
export function compareMavenVersions(a: MavenVersion, b: MavenVersion): number {
  return compareItems(a.root, b.root);
}

/** Convenience for strings; undefined when either side cannot be parsed. */
export function compareVersionStrings(a: string, b: string): number | undefined {
  const left = parseMavenVersion(a);
  const right = parseMavenVersion(b);
  return left && right ? compareMavenVersions(left, right) : undefined;
}

/** The leading numeric item (`2` in `2.9.10.4`), used to warn about major upgrades. */
export function majorVersion(version: MavenVersion): bigint | undefined {
  const first = version.root.items[0];
  return first?.kind === 'int' ? first.value : undefined;
}

function parseItems(version: string): ListItem {
  const root: ListItem = { kind: 'list', items: [] };
  let list = root;
  const stack: ListItem[] = [root];
  let isDigit = false;
  let start = 0;

  const startSublist = (): void => {
    const sub: ListItem = { kind: 'list', items: [] };
    list.items.push(sub);
    list = sub;
    stack.push(sub);
  };

  for (let i = 0; i < version.length; i++) {
    const c = version[i] as string;
    if (c === '.') {
      list.items.push(i === start ? intItem('0') : parseItem(isDigit, version.slice(start, i)));
      start = i + 1;
    } else if (c === '-') {
      list.items.push(i === start ? intItem('0') : parseItem(isDigit, version.slice(start, i)));
      start = i + 1;
      startSublist();
    } else if (c >= '0' && c <= '9') {
      if (!isDigit && i > start) {
        list.items.push(stringItem(version.slice(start, i), true));
        start = i;
        startSublist();
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        list.items.push(parseItem(true, version.slice(start, i)));
        start = i;
        startSublist();
      }
      isDigit = false;
    }
  }
  if (version.length > start) list.items.push(parseItem(isDigit, version.slice(start)));

  while (stack.length > 0) normalize(stack.pop() as ListItem);
  return root;
}

function parseItem(isDigit: boolean, text: string): Item {
  return isDigit ? intItem(text) : stringItem(text, false);
}

function intItem(text: string): IntItem {
  return { kind: 'int', value: BigInt(text) };
}

/** `a1` / `b2` / `m3` (a single letter followed by a digit) are short for alpha / beta / milestone. */
function stringItem(text: string, followedByDigit: boolean): StringItem {
  let value = text;
  if (followedByDigit && value.length === 1) {
    value = value === 'a' ? 'alpha' : value === 'b' ? 'beta' : value === 'm' ? 'milestone' : value;
  }
  return { kind: 'string', value: ALIASES[value] ?? value };
}

function isNull(item: Item): boolean {
  if (item.kind === 'int') return item.value === 0n;
  if (item.kind === 'string') return item.value === '';
  return item.items.length === 0;
}

/** Drops trailing null items (`1.0.0` → `1`), stopping at the first non-null non-list item. */
function normalize(list: ListItem): void {
  for (let i = list.items.length - 1; i >= 0; i--) {
    const item = list.items[i] as Item;
    if (isNull(item)) list.items.splice(i, 1);
    else if (item.kind !== 'list') break;
  }
}

function comparableQualifier(value: string): string {
  const index = QUALIFIERS.indexOf(value);
  return index >= 0 ? String(index) : `${QUALIFIERS.length}-${value}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Maven's Item.compareTo; `b === undefined` stands for a missing item on the other side. */
function compareItems(a: Item, b: Item | undefined): number {
  switch (a.kind) {
    case 'int':
      if (b === undefined) return a.value === 0n ? 0 : 1;
      if (b.kind === 'int') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      return 1; // a number is newer than a qualifier or a sub-list
    case 'string':
      if (b === undefined) return compareText(comparableQualifier(a.value), comparableQualifier(''));
      if (b.kind === 'int') return -1;
      if (b.kind === 'string') return compareText(comparableQualifier(a.value), comparableQualifier(b.value));
      return -1;
    case 'list': {
      if (b === undefined) {
        const first = a.items[0];
        return first === undefined ? 0 : compareItems(first, undefined);
      }
      if (b.kind === 'int') return -1;
      if (b.kind === 'string') return 1;
      const length = Math.max(a.items.length, b.items.length);
      for (let i = 0; i < length; i++) {
        const left = a.items[i];
        const right = b.items[i];
        const result =
          left === undefined ? (right === undefined ? 0 : -compareItems(right, undefined)) : compareItems(left, right);
        if (result !== 0) return result;
      }
      return 0;
    }
  }
}
