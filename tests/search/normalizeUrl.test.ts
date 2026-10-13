import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '@/lib/search/normalizeUrl';

describe('normalizeUrl', () => {
  it('strips tracking params, fragments and trailing slashes, and lowercases the host', () => {
    expect(normalizeUrl('https://Example.com/a/b/?utm_source=x&id=7&fbclid=zzz#top')).toBe('https://example.com/a/b/?id=7');
    expect(normalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });
  it('treats tracking variants of one page as the same URL', () => {
    expect(normalizeUrl('https://a.test/p?utm_medium=email')).toBe(normalizeUrl('https://a.test/p#frag'));
  });
  it('returns an unparsable input unchanged', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});
