import { describe, it, expect } from 'vitest';
import { createPriceProvider } from '@/lib/comparison/prices';
import { hang, jsonResponse, makeFetch } from '../helpers/http';

const listing = (entries: Record<string, [string, string]>) => ({
  data: Object.entries(entries).map(([id, [p, c]]) => ({ id, pricing: { prompt: p, completion: c } })),
});
const snapshot = { fetchedAt: '2026-01-01T00:00:00.000Z', prices: { 'a/model': { in: 1e-6, out: 2e-6 }, 'old/only': { in: 5e-6, out: 6e-6 } } };

describe('createPriceProvider', () => {
  it('reads live prices for the requested ids only and reports when they were fetched', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(listing({ 'a/model': ['0.000002', '0.00001'], 'b/model': ['0.1', '0.2'] })));
    const p = createPriceProvider({ fetchImpl, snapshot, now: () => Date.parse('2026-10-13T12:00:00Z') });
    const out = await p.get(['a/model']);
    expect(out.prices).toEqual({ 'a/model': { in: 0.000002, out: 0.00001 } });
    expect(out.asOf).toBe('2026-10-13T12:00:00.000Z');
    expect(calls).toHaveLength(1);
  });

  it('caches for the ttl, then refetches', async () => {
    let now = 0;
    const { fetchImpl, calls } = makeFetch(() => jsonResponse(listing({ 'a/model': ['0.000002', '0.00001'] })));
    const p = createPriceProvider({ fetchImpl, snapshot, ttlMs: 1000, now: () => now });
    await p.get(['a/model']);
    now = 500;
    await p.get(['a/model']);
    expect(calls).toHaveLength(1);
    now = 1500;
    await p.get(['a/model']);
    expect(calls).toHaveLength(2);
  });

  it('falls back to the committed snapshot when the fetch fails or returns an error', async () => {
    const down = createPriceProvider({ fetchImpl: makeFetch(() => jsonResponse({}, 500)).fetchImpl, snapshot });
    const out = await down.get(['a/model', 'old/only']);
    expect(out.prices['a/model']).toEqual({ in: 1e-6, out: 2e-6 });
    expect(out.asOf).toBe('2026-01-01T00:00:00.000Z');

    const broken = createPriceProvider({ fetchImpl: (async () => { throw new TypeError('network'); }) as typeof fetch, snapshot });
    expect((await broken.get(['old/only'])).prices['old/only']).toEqual({ in: 5e-6, out: 6e-6 });
  });

  it('omits a model that is in neither the live listing nor the snapshot, and ignores unparsable prices', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse(listing({ 'bad/model': ['free', 'n/a'], 'a/model': ['0.000002', '0.00001'] })));
    const out = await createPriceProvider({ fetchImpl, snapshot }).get(['a/model', 'bad/model', 'nowhere/model']);
    expect(Object.keys(out.prices)).toEqual(['a/model']);
  });

  it('REVIEW (final): a hung price fetch gives up quickly and falls back to the snapshot', async () => {
    const { fetchImpl } = makeFetch(hang);
    const started = Date.now();
    const out = await createPriceProvider({ fetchImpl, snapshot, timeoutMs: 20 }).get(['a/model']);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.prices['a/model']).toEqual({ in: 1e-6, out: 2e-6 });
  });

  it('REVIEW (final): a failed fetch is remembered briefly instead of being retried on every request', async () => {
    let now = 0;
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}, 503));
    const p = createPriceProvider({ fetchImpl, snapshot, failureTtlMs: 60_000, now: () => now });
    await p.get(['a/model']);
    now = 30_000;
    await p.get(['a/model']);
    expect(calls).toHaveLength(1);
    now = 61_000;
    await p.get(['a/model']);
    expect(calls).toHaveLength(2);
  });

  it('REVIEW (final): reports the snapshot date when any price came from the snapshot', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse(listing({ 'a/model': ['0.000002', '0.00001'] })));
    const p = createPriceProvider({ fetchImpl, snapshot, now: () => Date.parse('2026-10-13T12:00:00Z') });
    expect((await p.get(['a/model'])).asOf).toBe('2026-10-13T12:00:00.000Z'); // all live
    expect((await p.get(['a/model', 'old/only'])).asOf).toBe('2026-01-01T00:00:00.000Z'); // one from the snapshot
  });
});
