import { describe, it, expect } from 'vitest';
import { formatDuration, formatRatio, formatUsd, truncate } from '@/lib/ui/format';

describe('formatUsd', () => {
  it('keeps precision for tiny costs', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00521)).toBe('$0.0052');
    expect(formatUsd(0.2902)).toBe('$0.290');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});
describe('formatDuration', () => {
  it('formats milliseconds, seconds and minutes', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(38_000)).toBe('38s');
    expect(formatDuration(125_000)).toBe('2m 05s');
  });
});
describe('formatRatio', () => {
  it('shows a dash for null and sensible precision otherwise', () => {
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(55.7)).toBe('56×');
    expect(formatRatio(1.09)).toBe('1.1×');
    expect(formatRatio(0.42)).toBe('0.42×');
  });
});
describe('truncate', () => {
  it('shortens with an ellipsis and collapses whitespace', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a   long\nprompt here', 10)).toBe('a long pro…');
  });
});
