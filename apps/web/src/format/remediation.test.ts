import { describe, expect, it } from 'vitest';
import { formatActionKind, formatFixStatus, formatUpgrade } from './remediation';

describe('remediation formatting', () => {
  it('labels statuses, actions and upgrades', () => {
    expect(formatFixStatus('STILL_AFFECTED')).toBe('Still affected');
    expect(formatActionKind('OVERRIDE_TRANSITIVE')).toBe('Pin transitive version');
    expect(formatUpgrade('1.9', '1.10.0')).toBe('1.9 → 1.10.0');
    expect(formatUpgrade('1.7', undefined)).toBe('1.7 (no fixed version)');
  });
});
