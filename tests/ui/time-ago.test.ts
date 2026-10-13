import { describe, it, expect } from 'vitest';
import { timeAgo } from '@/lib/ui/time-ago';

const now = Date.parse('2026-10-13T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('timeAgo', () => {
  it('uses compact relative units', () => {
    expect(timeAgo(ago(10_000), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m ago');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2d ago');
  });
  it('falls back to a date after a week and never goes negative', () => {
    expect(timeAgo(ago(10 * 86_400_000), now)).toMatch(/Oct|Sep/);
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe('just now');
  });
});
